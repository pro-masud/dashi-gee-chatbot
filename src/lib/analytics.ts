// Consent-safe GA4 / GTM / Meta Pixel E-Commerce Tracking Hooks
declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

const firedPurchaseOrderIds = new Set<string>();

export function trackStoreEvent(
  eventName: 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase',
  params: Record<string, unknown>
): void {
  if (eventName === 'Purchase') {
    const orderId = String(params.transaction_id || '');
    if (!orderId || firedPurchaseOrderIds.has(orderId)) return;
    firedPurchaseOrderIds.add(orderId);
  }

  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    }
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName, ...params });
    }
    if (typeof window.fbq === 'function') {
      window.fbq('track', eventName, params);
    }
  } catch {
    // never block storefront interaction on analytics errors
  }
}
