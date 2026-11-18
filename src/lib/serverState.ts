export interface NotificationAttemptLog {
  orderNumber: string;
  channel: string;
  status: 'sent' | 'skipped_unconfigured' | 'failed';
  detail: string;
  timestamp: string;
}

const globalStore = globalThis as unknown as {
  __deshiGeeRecentSubmissions?: Map<string, number>;
  __deshiGeePhoneRateWindow?: Map<string, number[]>;
  __deshiGeeNotificationLogs?: NotificationAttemptLog[];
};

export const recentSubmissions =
  globalStore.__deshiGeeRecentSubmissions ??
  (globalStore.__deshiGeeRecentSubmissions = new Map<string, number>());

export const phoneRateWindow =
  globalStore.__deshiGeePhoneRateWindow ??
  (globalStore.__deshiGeePhoneRateWindow = new Map<string, number[]>());

export const notificationLogs =
  globalStore.__deshiGeeNotificationLogs ??
  (globalStore.__deshiGeeNotificationLogs = []);

export const DEFAULT_WEIGHT_PRICES: Record<string, number> = {
  '250g': 680,
  '500g': 1290,
  '1kg': 2480,
};

export async function dispatchWebhookWithRetry(
  url: string,
  channel: string,
  payload: Record<string, unknown>,
  maxRetries = 3
): Promise<NotificationAttemptLog> {
  let lastError = 'Unknown error';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        return {
          orderNumber: String(payload.orderNumber || ''),
          channel,
          status: 'sent',
          detail: `HTTP ${res.status}`,
          timestamp: new Date().toISOString(),
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Request failed';
    }
    if (attempt < maxRetries) {
      const delayMs = 300 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return {
    orderNumber: String(payload.orderNumber || ''),
    channel,
    status: 'failed',
    detail: lastError,
    timestamp: new Date().toISOString(),
  };
}
