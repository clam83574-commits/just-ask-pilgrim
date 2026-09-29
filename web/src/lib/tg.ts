/* Тонкая обёртка над Telegram WebApp. Вне Telegram всё работает в режиме браузера. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WebApp: any = (window as any).Telegram?.WebApp ?? null;
export const inTelegram = !!WebApp?.initData;

export function initTelegram() {
  const applyTheme = () => {
    const scheme = WebApp?.colorScheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = scheme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    try {
      WebApp?.setHeaderColor?.(bg);
      WebApp?.setBackgroundColor?.(bg);
      WebApp?.setBottomBarColor?.(bg);
    } catch { /* старые клиенты */ }
  };
  applyTheme();
  if (!WebApp) return;
  WebApp.ready();
  WebApp.expand();
  try { WebApp.disableVerticalSwipes?.(); } catch { /* ignore */ }
  WebApp.onEvent?.('themeChanged', applyTheme);
}

export const initData = (): string => WebApp?.initData ?? '';
export const tgUser = () => WebApp?.initDataUnsafe?.user ?? null;
export const startParam = (): string | null =>
  WebApp?.initDataUnsafe?.start_param ?? new URLSearchParams(location.search).get('startapp');

export const haptic = {
  tap: () => WebApp?.HapticFeedback?.impactOccurred?.('light'),
  soft: () => WebApp?.HapticFeedback?.impactOccurred?.('soft'),
  ok: () => WebApp?.HapticFeedback?.notificationOccurred?.('success'),
  err: () => WebApp?.HapticFeedback?.notificationOccurred?.('error'),
  select: () => WebApp?.HapticFeedback?.selectionChanged?.(),
};

export function openLink(url: string) {
  if (WebApp?.openLink) WebApp.openLink(url);
  else window.open(url, '_blank');
}

export function openTgLink(url: string) {
  if (WebApp?.openTelegramLink) WebApp.openTelegramLink(url);
  else window.open(url, '_blank');
}

export function walkTo(lat: number, lon: number) {
  openLink(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`);
}

export function setBackButton(handler: (() => void) | null) {
  const bb = WebApp?.BackButton;
  if (!bb) return () => {};
  if (!handler) {
    bb.hide();
    return () => {};
  }
  bb.show();
  bb.onClick(handler);
  return () => {
    bb.offClick(handler);
    bb.hide();
  };
}

export function scanQr(text: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!WebApp?.showScanQrPopup || !WebApp.isVersionAtLeast?.('6.4')) return resolve(null);
    WebApp.showScanQrPopup({ text }, (value: string) => {
      resolve(value);
      return true;
    });
    WebApp.onEvent?.('scanQrPopupClosed', () => resolve(null));
  });
}

export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!WebApp?.requestWriteAccess || !WebApp.isVersionAtLeast?.('6.9')) return resolve(false);
    try {
      WebApp.requestWriteAccess((granted: boolean) => resolve(!!granted));
    } catch {
      resolve(false);
    }
  });
}

export function confirmPopup(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (WebApp?.showConfirm) WebApp.showConfirm(message, (ok: boolean) => resolve(!!ok));
    else resolve(window.confirm(message));
  });
}

export function shareText(url: string, text: string) {
  openTgLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

/** Геопозиция: сначала Telegram LocationManager (Bot API 8.0+), потом браузер. */
export function getLocation(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    const lm = WebApp?.LocationManager;
    const viaBrowser = () => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    };
    if (lm && WebApp.isVersionAtLeast?.('8.0')) {
      const go = () => {
        if (!lm.isLocationAvailable) return viaBrowser();
        lm.getLocation((loc: any) => (loc ? resolve({ lat: loc.latitude, lon: loc.longitude }) : viaBrowser()));
      };
      if (lm.isInited) go();
      else lm.init(go);
    } else viaBrowser();
  });
}
