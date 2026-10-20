import { createConnection } from "node:net";
import { once } from "node:events";

export interface SocksProbe { reply: number; classification: "connected" | "policy-denied" | "resolution-failed" | "connect-failed" | "other" }
export async function probeSocksDomain(proxy: string, host: string, port: number, signal: AbortSignal): Promise<SocksProbe> {
  signal.throwIfAborted();
  const url = new URL(proxy), name = Buffer.from(host, "ascii");
  if (!["socks5:", "socks5h:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname && url.pathname !== "/" ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || name.length > 253 || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Use one exact DNS target and the existing unauthenticated loopback SOCKS endpoint.");
  const abort = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  const socket = createConnection({ host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port ? Number(url.port) : 1080 });
  let buffer: Buffer = Buffer.alloc(0), failure: Error | undefined, ended = false;
  const waiting: { size: number; resolve: (value: Buffer) => void; reject: (error: Error) => void }[] = [];
  const reject = (error: Error) => { failure ??= error; for (const waiter of waiting.splice(0)) waiter.reject(failure); };
  const cancel = () => { reject(new Error("Owned SOCKS diagnostic was cancelled or timed out.")); socket.destroy(); };
  const data = (part: Buffer) => {
    if (buffer.length + part.length > 1024) { reject(new Error("SOCKS diagnostic reply exceeded its bound.")); socket.destroy(); return; }
    buffer = Buffer.concat([buffer, part]);
    while (waiting[0] && buffer.length >= waiting[0].size) {
      const waiter = waiting.shift()!, value = buffer.subarray(0, waiter.size); buffer = buffer.subarray(waiter.size); waiter.resolve(value);
    }
  };
  const closed = () => { ended = true; if (waiting.length) reject(new Error("SOCKS diagnostic closed before a complete framed reply.")); };
  socket.on("data", data); socket.on("error", reject); socket.on("end", closed); socket.on("close", closed);
  abort.addEventListener("abort", cancel, { once: true });
  const read = (size: number): Promise<Buffer> => {
    if (failure) return Promise.reject(failure);
    if (buffer.length >= size) { const result = buffer.subarray(0, size); buffer = buffer.subarray(size); return Promise.resolve(result); }
    if (ended) return Promise.reject(new Error("SOCKS diagnostic closed before a complete framed reply."));
    return new Promise((resolve, reject) => waiting.push({ size, resolve, reject }));
  };
  try {
    await once(socket, "connect", { signal: abort }); abort.throwIfAborted();
    socket.write(Buffer.from([5, 1, 0]));
    const method = await read(2);
    if (method[0] !== 5 || method[1] !== 0) throw new Error("The SOCKS diagnostic did not negotiate the expected no-auth method.");
    socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255])]));
    const header = await read(4);
    if (header[0] !== 5 || header[2] !== 0 || header[1]! > 8) throw new Error("Malformed SOCKS diagnostic header.");
    if (header[3] === 1) await read(6);
    else if (header[3] === 4) await read(18);
    else if (header[3] === 3) { const size = (await read(1))[0]!; if (!size) throw new Error("Empty SOCKS diagnostic address."); await read(size + 2); }
    else throw new Error("Unsupported SOCKS diagnostic address type.");
    const reply = header[1]!;
    return { reply, classification: reply === 0 ? "connected" : reply === 2 ? "policy-denied" : reply === 4 ? "resolution-failed" : reply === 5 ? "connect-failed" : "other" };
  } finally { abort.removeEventListener("abort", cancel); socket.destroy(); }
}
