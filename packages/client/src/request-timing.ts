export interface ResponseTiming {
  serviceMs: number | null;
  proxyBodyMs: number | null;
  proxyHeadersMs: number | null;
  serviceLoopMs: number | null;
  serviceWindowMs: number | null;
  proxyLoopMs: number | null;
  proxyWindowMs: number | null;
}
export function responseTiming(header: string | null): ResponseTiming {
  const duration = (name: string): number | null => {
    if (!header || header.length > 2048) return null;
    const match = header.match(new RegExp(`(?:^|,)\\s*moguri-${name};dur=(\\d+(?:\\.\\d+)?)(?=\\s*(?:,|$))`));
    const value = match ? Number(match[1]) : null;
    return value !== null && Number.isFinite(value) && value >= 0 && value <= 86_400_000 ? value : null;
  };
  return { serviceMs: duration("service"), proxyBodyMs: duration("proxy-body"), proxyHeadersMs: duration("proxy-headers"),
    serviceLoopMs: duration("service-loop"), serviceWindowMs: duration("service-window"),
    proxyLoopMs: duration("proxy-loop"), proxyWindowMs: duration("proxy-window") };
}
