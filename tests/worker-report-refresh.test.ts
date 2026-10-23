import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  formatWorkerReportValue,
  startWorkerReportPolling,
  WORKER_REPORT_REFRESH_INTERVAL_MS,
} from '../src/lib/worker-report-refresh';

async function settleAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Worker report refresh', () => {
  it('fetches updated assigned-user values after an Admin import and retains the selected date', async () => {
    const visibilityTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    let tick: (() => void) | undefined;
    let intervalMs = 0;
    const scheduler = {
      setInterval: vi.fn((callback: () => void, milliseconds: number) => { tick = callback; intervalMs = milliseconds; return 1; }),
      clearInterval: vi.fn(),
    };
    let latestApiReports = [{ username: 'my-user', reportValue: 3 }, { username: 'other-assigned', reportValue: null }];
    const displayedReports: typeof latestApiReports[] = [];
    const requestUrls: string[] = [];
    const refresh = vi.fn(async (_signal: AbortSignal, isActive: () => boolean) => {
      requestUrls.push('/api/reports?date=2026-10-10');
      const response = { reports: latestApiReports };
      if (isActive()) displayedReports.push(response.reports);
    });

    const polling = startWorkerReportPolling(refresh, {
      documentTarget: visibilityTarget,
      scheduler: scheduler as unknown as Window,
    });
    await settleAsyncWork();
    expect(displayedReports.at(-1)).toEqual([
      { username: 'my-user', reportValue: 3 },
      { username: 'other-assigned', reportValue: null },
    ]);
    expect(intervalMs).toBe(WORKER_REPORT_REFRESH_INTERVAL_MS);

    // Represents a successful Admin import/correction becoming visible through the same report API.
    latestApiReports = [{ username: 'my-user', reportValue: 8 }, { username: 'other-assigned', reportValue: 0 }];
    tick?.();
    await settleAsyncWork();

    expect(displayedReports.at(-1)).toEqual([
      { username: 'my-user', reportValue: 8 },
      { username: 'other-assigned', reportValue: 0 },
    ]);
    expect(requestUrls).toEqual(['/api/reports?date=2026-10-10', '/api/reports?date=2026-10-10']);
    polling.stop();
  });

  it('refreshes when the tab becomes visible and coalesces overlapping requests', async () => {
    const visibilityTarget = Object.assign(new EventTarget(), { visibilityState: 'hidden' as DocumentVisibilityState });
    let tick: (() => void) | undefined;
    const scheduler = {
      setInterval: vi.fn((callback: () => void) => { tick = callback; return 1; }),
      clearInterval: vi.fn(),
    };
    const waiting = deferred();
    let calls = 0;
    const refresh = vi.fn(async () => { calls += 1; await waiting.promise; });
    const polling = startWorkerReportPolling(refresh, { documentTarget: visibilityTarget, scheduler: scheduler as unknown as Window });

    expect(calls).toBe(0);
    tick?.();
    expect(calls).toBe(0);
    visibilityTarget.visibilityState = 'visible';
    visibilityTarget.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toBe(1);
    tick?.();
    visibilityTarget.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toBe(1);

    waiting.resolve();
    await settleAsyncWork();
    expect(calls).toBe(2);
    polling.stop();
  });

  it('cancels its timer and prevents updates after stop', async () => {
    const visibilityTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const waiting = deferred();
    let callbackActive: (() => boolean) | undefined;
    const scheduler = { setInterval: vi.fn(() => 7), clearInterval: vi.fn() };
    const refresh = vi.fn(async (_signal: AbortSignal, isActive: () => boolean) => { callbackActive = isActive; await waiting.promise; });
    const polling = startWorkerReportPolling(refresh, { documentTarget: visibilityTarget, scheduler: scheduler as unknown as Window });

    polling.stop();
    expect(scheduler.clearInterval).toHaveBeenCalledWith(7);
    expect(callbackActive?.()).toBe(false);
    waiting.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(callbackActive?.()).toBe(false);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps a real zero distinct from a missing report', () => {
    expect(formatWorkerReportValue(0)).toBe(0);
    expect(formatWorkerReportValue(null)).toBe('Not received');
  });

  it('wires the Worker table to selected-date polling without consuming Admin totals', () => {
    const source = readFileSync(new URL('../src/components/worker-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('My Report History');
    expect(source).toContain('id="my-report-history"');
    expect(source).toContain('No active usernames assigned for report history.');
    expect(source).toContain('startWorkerReportPolling');
    expect(source).toContain('`/api/reports?date=${encodeURIComponent(requestedDate)}`');
    expect(source).toContain('reportDateRef.current = event.target.value');
    expect(source).toContain('formatWorkerReportValue(report.reportValue)');
    expect(source).not.toContain('reportData.total');
  });
});
