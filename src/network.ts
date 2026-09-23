export interface NetworkPingResult {
  reachable: boolean;
  latencyMs?: number;
}

export interface CheckReachabilityOptions {
  url?: string;
  timeoutMs?: number;
  force?: boolean;
}

let cachedStatus: boolean | null = null;
let lastPingTime = 0;
const CACHE_TTL_MS = 20_000; // 20s cache to prevent hammering local router

export async function checkRouterReachability(
  urlOrOptions: string | CheckReachabilityOptions = 'http://10.0.0.1/',
  legacyTimeoutMs = 1500
): Promise<boolean> {
  const options: CheckReachabilityOptions =
    typeof urlOrOptions === 'string'
      ? { url: urlOrOptions, timeoutMs: legacyTimeoutMs, force: false }
      : { url: 'http://10.0.0.1/', timeoutMs: 1500, force: false, ...urlOrOptions };

  const targetUrl = options.url || 'http://10.0.0.1/';
  const timeoutMs = options.timeoutMs ?? 1500;
  const force = Boolean(options.force);

  const now = Date.now();
  if (!force && cachedStatus !== null && now - lastPingTime < CACHE_TTL_MS) {
    return cachedStatus;
  }

  let isReachable = false;
  const globalScope = typeof window !== 'undefined' ? window : globalThis;
  if ('fetch' in globalScope && 'AbortController' in globalScope) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(`${targetUrl.replace(/\/$/, '')}/favicon.ico?_t=${Date.now()}`, {
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
type Timer = NodeJS.Timeout | number;

export type ConnectivityListener = (connected: boolean) => void;

export interface NetworkMonitorOptions {
  url?: string;
  timeoutMs?: number;
  onlineIntervalMs?: number;
  offlineIntervalMs?: number;
}

export class NetworkMonitor {
  private url: string;
  private timeoutMs: number;
  private onlineIntervalMs: number;
  private offlineIntervalMs: number;
  private timer: Timer | undefined = undefined;
  private running = false;
  private lastKnownStatus: boolean | null = null;
  private listeners = new Set<ConnectivityListener>();
  private handleOnline = () => void this.forceCheck();
  private handleFocus = () => void this.forceCheck();
  private handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void this.forceCheck();
    }
  };

  constructor(options: NetworkMonitorOptions = {}) {
    this.url = options.url || 'http://10.0.0.1/';
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.onlineIntervalMs = options.onlineIntervalMs ?? 30_000;
    this.offlineIntervalMs = options.offlineIntervalMs ?? 4_000;
  }

  public isConnected(): boolean | null {
    return this.lastKnownStatus;
  }

  public subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    if (this.lastKnownStatus !== null) {
      listener(this.lastKnownStatus);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('focus', this.handleFocus);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
      }
    }

    this.scheduleNext(0);
  }

  public stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('focus', this.handleFocus);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      }
    }
  }

  public async forceCheck(): Promise<boolean> {
    invalidateRouterCache();
    const reachable = await checkRouterReachability({
      url: this.url,
      timeoutMs: this.timeoutMs,
      force: true,
    });
    this.updateStatus(reachable);
    if (this.running) {
      this.scheduleNext(reachable ? this.onlineIntervalMs : this.offlineIntervalMs);
    }
    return reachable;
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      if (!this.running) return;
      const reachable = await checkRouterReachability({
        url: this.url,
        timeoutMs: this.timeoutMs,
        force: true,
      });
      this.updateStatus(reachable);
      if (this.running) {
        this.scheduleNext(reachable ? this.onlineIntervalMs : this.offlineIntervalMs);
      }
    }, delayMs);
  }

  private updateStatus(reachable: boolean): void {
    const changed = this.lastKnownStatus !== reachable;
    this.lastKnownStatus = reachable;
    if (changed) {
      for (const listener of this.listeners) {
        try {
          listener(reachable);
        } catch (err) {
          console.error('Error in connectivity listener:', err);
        }
      }
    }
  }
}

export const networkMonitor = new NetworkMonitor();
