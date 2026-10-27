/**
 * PWA helpers — ลงทะเบียน service worker และจัดการ event การติดตั้งแอป
 */

export type InstallPromptEvent = Event & {
  readonly platforms?: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
let justInstalled = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const listener of subscribers) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    justInstalled = true;
    notify();
  });
}

export function subscribeInstall(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function getInstallPrompt() {
  return deferredPrompt;
}

export function wasJustInstalled() {
  return justInstalled;
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone;
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ รายงานตัวเป็น Macintosh แต่มีจอสัมผัส
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  deferredPrompt = null;
  notify();
  await event.prompt();
  const choice = await event.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  return choice.outcome;
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => {
    // โหมด dev ส่ง env=dev เพื่อให้ SW ไม่แคชไฟล์ HMR
    const swUrl = import.meta.env.DEV ? '/sw.js?env=dev' : '/sw.js';
    navigator.serviceWorker.register(swUrl, { scope: '/' }).catch((error) => {
      console.warn('[lumen] ลงทะเบียน service worker ไม่สำเร็จ', error);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
