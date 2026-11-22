import type { TrackingSettings } from './marketing';

type PublicTracking = Pick<TrackingSettings, 'pixelId' | 'ga4Id' | 'gtmId' | 'googleAdsId'>;

declare global {
  interface Window {
    __dgTrackersLoaded?: boolean;
    _fbq?: unknown;
  }
}

function addScript(src: string, id: string): void {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/**
 * Load the owner-configured tracking scripts once. Ids are validated server-side
 * (digits / G- / GTM- / AW- patterns), so nothing else can be injected through them.
 */
export function loadTrackers(cfg: PublicTracking): void {
  if (typeof window === 'undefined' || window.__dgTrackersLoaded) return;
  window.__dgTrackersLoaded = true;
  window.dataLayer = window.dataLayer || [];

  if (cfg.gtmId) {
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    addScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(cfg.gtmId)}`, 'dg-gtm');
  }

  const gaTarget = cfg.ga4Id || cfg.googleAdsId;
  if (gaTarget) {
    window.gtag =
      window.gtag ||
      function gtag(...args: unknown[]) {
        window.dataLayer!.push(args as unknown as Record<string, unknown>);
      };
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaTarget)}`, 'dg-gtag');
    window.gtag('js', new Date());
    if (cfg.ga4Id) window.gtag('config', cfg.ga4Id);
    if (cfg.googleAdsId) window.gtag('config', cfg.googleAdsId);
  }

  if (cfg.pixelId && !window.fbq) {
    const fbq = function (...args: unknown[]) {
      (fbq as unknown as { queue: unknown[][] }).queue.push(args);
    } as unknown as ((...a: unknown[]) => void) & { queue: unknown[][]; loaded: boolean; version: string };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    window.fbq = fbq;
    addScript('https://connect.facebook.net/en_US/fbevents.js', 'dg-fbevents');
    window.fbq('init', cfg.pixelId);
    window.fbq('track', 'PageView');
  }
}
