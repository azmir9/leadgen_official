export const WORKER_REPORT_REFRESH_INTERVAL_MS = 30_000;

export type WorkerReportRefresh = (signal: AbortSignal, isActive: () => boolean) => Promise<void>;

type VisibilityTarget = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
type IntervalScheduler = Pick<Window, 'setInterval' | 'clearInterval'>;

export function startWorkerReportPolling(
  refresh: WorkerReportRefresh,
  options: { documentTarget: VisibilityTarget; scheduler: IntervalScheduler; intervalMs?: number },
) {
  let active = true;
  let inFlight = false;
  let refreshQueued = false;
  let activeController: AbortController | null = null;

  const runRefresh = () => {
    if (!active || options.documentTarget.visibilityState !== 'visible') return;
    if (inFlight) {
      refreshQueued = true;
      return;
    }

    inFlight = true;
    const controller = new AbortController();
    activeController = controller;

    void refresh(controller.signal, () => active).catch(() => undefined).finally(() => {
      if (activeController === controller) activeController = null;
      inFlight = false;
      if (active && refreshQueued) {
        refreshQueued = false;
        runRefresh();
      }
    });
  };

  const handleVisibilityChange = () => {
    if (options.documentTarget.visibilityState === 'visible') runRefresh();
  };

  const intervalId = options.scheduler.setInterval(runRefresh, options.intervalMs ?? WORKER_REPORT_REFRESH_INTERVAL_MS);
  options.documentTarget.addEventListener('visibilitychange', handleVisibilityChange);
  runRefresh();

  return {
    refresh: runRefresh,
    stop() {
      if (!active) return;
      active = false;
      refreshQueued = false;
      options.scheduler.clearInterval(intervalId);
      options.documentTarget.removeEventListener('visibilitychange', handleVisibilityChange);
      activeController?.abort();
      activeController = null;
    },
  };
}

export function formatWorkerReportValue(reportValue: number | null) {
  return reportValue ?? 'Not received';
}
