import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkRouterReachability,
  invalidateRouterCache,
  NetworkMonitor,
} from './network';

describe('checkRouterReachability', () => {
  beforeEach(() => {
    invalidateRouterCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when fetch succeeds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    const reachable = await checkRouterReachability('http://10.0.0.1/');
    expect(reachable).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caches the result within CACHE_TTL_MS', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    const first = await checkRouterReachability('http://10.0.0.1/');
    const second = await checkRouterReachability('http://10.0.0.1/');
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('bypasses cache when force option is true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    await checkRouterReachability('http://10.0.0.1/');
    await checkRouterReachability({ url: 'http://10.0.0.1/', force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('bypasses cache when invalidateRouterCache is called', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    await checkRouterReachability('http://10.0.0.1/');
    invalidateRouterCache();
    await checkRouterReachability('http://10.0.0.1/');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns false when fetch aborts due to timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);
    const reachable = await checkRouterReachability('http://10.0.0.1/');
    expect(reachable).toBe(false);
  });
});

describe('NetworkMonitor', () => {
  beforeEach(() => {
    invalidateRouterCache();
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('notifies subscribers on connection status change', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    const monitor = new NetworkMonitor({
      url: 'http://10.0.0.1/',
      onlineIntervalMs: 10_000,
      offlineIntervalMs: 2_000,
    });

    const statuses: boolean[] = [];
    const unsubscribe = monitor.subscribe((status) => statuses.push(status));

    monitor.start();
    await vi.runOnlyPendingTimersAsync();

    expect(statuses).toEqual([true]);
    expect(monitor.isConnected()).toBe(true);

    monitor.stop();
    unsubscribe();
  });

  it('recursively checks with offlineInterval when disconnected and switches interval when connected', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    // Start offline
    fetchSpy.mockRejectedValueOnce(abortError);
    // Next attempt succeeds
    fetchSpy.mockResolvedValueOnce(new Response());

    const monitor = new NetworkMonitor({
      url: 'http://10.0.0.1/',
      onlineIntervalMs: 30_000,
      offlineIntervalMs: 3_000,
    });

    const events: boolean[] = [];
    monitor.subscribe((status) => events.push(status));

    monitor.start();
    // Initial check runs
    await vi.runOnlyPendingTimersAsync();
    expect(events).toEqual([false]);
    expect(monitor.isConnected()).toBe(false);

    // Advance by offline interval (3_000ms)
    await vi.advanceTimersByTimeAsync(3_000);
    expect(events).toEqual([false, true]);
    expect(monitor.isConnected()).toBe(true);

    monitor.stop();
  });

  it('immediately checks and notifies on forceCheck', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    const monitor = new NetworkMonitor({
      url: 'http://10.0.0.1/',
      onlineIntervalMs: 10_000,
      offlineIntervalMs: 2_000,
    });

    const events: boolean[] = [];
    monitor.subscribe((status) => events.push(status));

    const result = await monitor.forceCheck();
    expect(result).toBe(true);
    expect(events).toEqual([true]);
  });

  it('stops scheduling when stopped', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    const monitor = new NetworkMonitor({
      onlineIntervalMs: 5_000,
      offlineIntervalMs: 1_000,
    });

    monitor.start();
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    monitor.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    // No new pings should occur while stopped
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
