import argparse
import hashlib
import ipaddress
import json
import socket
import struct
import time
from pathlib import Path


def header(frame, upstream, ports=None):
    if len(frame) < 42 or frame[12:14] != b"\x08\x00":
        return None
    ip = frame[14:]
    ihl = (ip[0] & 15) * 4
    if ip[0] >> 4 != 4 or ihl < 20 or ip[9] != 17 or len(ip) < ihl + 20:
        return None
    if struct.unpack("!H", ip[6:8])[0] & 0x3FFF:
        return None
    source = str(ipaddress.IPv4Address(ip[12:16]))
    target = str(ipaddress.IPv4Address(ip[16:20]))
    source_port, target_port, length = struct.unpack("!HHH", ip[ihl:ihl + 6])
    if length < 20 or len(ip) < ihl + length:
        return None
    if target == upstream and target_port == 53:
        direction = "query"
    elif source_port == 53 and (source == upstream or ports is not None and target_port in ports):
        direction = "response"
    else:
        return None
    dns = ip[ihl + 8:ihl + length]
    identifier, flags, questions, answers = struct.unpack("!HHHH", dns[:8])
    qtype = None
    if questions == 1:
        index, labels = 12, 0
        while index < len(dns) and labels < 128:
            size = dns[index]
            index += 1
            if size == 0:
                break
            if size & 0xC0 == 0xC0:
                index += 1
                break
            if size > 63:
                return None
            index += size
            labels += 1
        if index + 4 > len(dns):
            return None
        qtype = struct.unpack("!H", dns[index:index + 2])[0]
    if qtype not in (1, 28):
        return None
    result = {"direction": direction, "id": identifier, "qtype": qtype,
            "rcode": flags & 15, "truncated": bool(flags & 0x0200),
            "answers": answers, "source_port": source_port,
            "target_port": target_port}
    if direction == "response":
        result["expected_source"] = source == upstream
    else:
        result["query_hash"] = hashlib.sha256(dns[2:]).hexdigest()
    return result


def self_test():
    import unittest

    class Frames(unittest.TestCase):
        def packet(self, response=False, qtype=1):
            question = b"\x03api\x06github\x00" + struct.pack("!HH", qtype, 1)
            dns = struct.pack("!HHHHHH", 513, 0x8180 if response else 0x0100, 1, 0, 0, 0) + question
            addresses = ("192.168.64.1", "192.168.64.2") if response else ("192.168.64.2", "192.168.64.1")
            ip = bytearray(20)
            ip[0], ip[9] = 0x45, 17
            ip[12:16], ip[16:20] = (socket.inet_aton(value) for value in addresses)
            ports = (53, 41000) if response else (41000, 53)
            return b"\0" * 12 + b"\x08\x00" + ip + struct.pack("!HHHH", *ports, len(dns) + 8, 0) + dns

        def test_headers_only(self):
            for response in (False, True):
                for kind in (1, 28):
                    value = header(self.packet(response, kind), "192.168.64.1")
                    self.assertEqual(value["direction"], "response" if response else "query")
                    self.assertEqual((value["id"], value["qtype"]), (513, kind))
                    self.assertNotIn("payload", value)
                    self.assertNotIn("name", value)

        def test_unrelated_truncated_or_unsupported(self):
            frame = self.packet()
            self.assertIsNone(header(frame, "192.168.64.9"))
            for size in (0, 20, len(frame) - 1):
                self.assertIsNone(header(frame[:size], "192.168.64.1"))
            self.assertIsNone(header(self.packet(qtype=16), "192.168.64.1"))

        def test_question_hash_ignores_only_transaction_id(self):
            frame = bytearray(self.packet())
            before = header(bytes(frame), "192.168.64.1")
            frame[42:44] = struct.pack("!H", 514)
            after = header(bytes(frame), "192.168.64.1")
            self.assertEqual(before["query_hash"], after["query_hash"])
            self.assertNotEqual(before["id"], after["id"])
            self.assertNotEqual(before["query_hash"], header(self.packet(qtype=28), "192.168.64.1")["query_hash"])

        def test_wrong_source_is_observed_only_for_a_tracked_request_port(self):
            frame = bytearray(self.packet(response=True))
            frame[26:30] = socket.inet_aton("192.168.64.9")
            self.assertIsNone(header(bytes(frame), "192.168.64.1"))
            self.assertIsNone(header(bytes(frame), "192.168.64.1", {41001}))
            self.assertFalse(header(bytes(frame), "192.168.64.1", {41000})["expected_source"])

    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Frames))
    if not result.wasSuccessful():
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--seconds", type=float, default=12)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not 1 <= args.seconds <= 20:
        raise ValueError("Use a bounded 1-20 second owned observation.")
    state = json.loads(Path("/run/sendbox/egress-resolver-state.json").read_text())
    upstream, port = state["upstream"].rsplit(":", 1)
    upstream = str(ipaddress.IPv4Address(upstream))
    if port != "53":
        raise ValueError("Unexpected non-DNS resolver endpoint.")
    # ETH_P_ALL includes outbound requests; only scoped DNS metadata is retained.
    with socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0003)) as capture:
        capture.settimeout(0.25)
        print(json.dumps({"observer": "ready", "upstream": upstream, "headers_only": True}), flush=True)
        start, count, ports = time.monotonic(), 0, set()
        while time.monotonic() - start < args.seconds and count < 64:
            try:
                frame = capture.recv(65536)
            except socket.timeout:
                continue
            value = header(frame, upstream, ports)
            if value is not None:
                if value["direction"] == "query":
                    ports.add(value["source_port"])
                value["elapsed_ms"] = round((time.monotonic() - start) * 1000, 2)
                print(json.dumps(value), flush=True)
                count += 1
        print(json.dumps({"observer": "complete", "events": count}), flush=True)


if __name__ == "__main__":
    main()
