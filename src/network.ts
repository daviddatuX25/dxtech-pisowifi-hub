export interface NetworkPingResult {
  reachable: boolean;
  latencyMs?: number;
}

let cachedStatus: boolean | null = null;
let lastPingTime = 0;
const CACHE_TTL_MS = 20_000; // 20s cache to prevent hammering local router

export async function checkRouterReachability(
  url = 'http://10.0.0.1/',
  timeoutMs = 1500
): Promise<boolean> {
  const now = Date.now();
  if (cachedStatus !== null && now - lastPingTime < CACHE_TTL_MS) {
    return cachedStatus;
  }

  // Use fetch with AbortController and mode 'no-cors'
  let isReachable = false;
  const globalScope = typeof window !== 'undefined' ? window : globalThis;
  if ('fetch' in globalScope && 'AbortController' in globalScope) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(`${url.replace(/\/$/, '')}/favicon.ico?_t=${Date.now()}`, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      isReachable = true;
    } catch (e: unknown) {
      clearTimeout(timer);
      if (e instanceof Error && e.name !== 'AbortError') {
        isReachable = true;
      } else {
        isReachable = false;
      }
    }
  } else {
    isReachable = false;
  }

  cachedStatus = isReachable;
  lastPingTime = now;
  return isReachable;
}

export function invalidateRouterCache(): void {
  cachedStatus = null;
  lastPingTime = 0;
}
