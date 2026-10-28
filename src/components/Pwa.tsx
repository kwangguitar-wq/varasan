import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from './Icons';
import {
  getInstallPrompt,
  isIosDevice,
  isStandalone,
  promptInstall,
  subscribeInstall,
  wasJustInstalled,
} from '../lib/pwa';

const DISMISS_KEY = 'nakhonmaesot.install.dismissedAt';
const DISMISS_DAYS = 7;

function readDismissedAt() {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function InstallPrompt() {
  const hasPrompt = useSyncExternalStore(subscribeInstall, () => Boolean(getInstallPrompt()), () => false);
  const installed = useSyncExternalStore(subscribeInstall, wasJustInstalled, () => false);
  const ios = isIosDevice();
  const { pathname } = useLocation();
  const reading = pathname.startsWith('/read/');
  const [standalone, setStandalone] = useState(false);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'working'>('idle');

  useEffect(() => {
    setStandalone(isStandalone());
    const media = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setStandalone(isStandalone());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (standalone || installed || reading) {
      setVisible(false);
      return;
    }
    // Chrome/Edge/Android แจ้งเตือนผ่าน beforeinstallprompt, iOS ต้องแนะนำเอง
    if (!hasPrompt && !ios) {
      setVisible(false);
      return;
    }
    if (Date.now() - readDismissedAt() < DISMISS_DAYS * 86400000) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 1500);
    return () => window.clearTimeout(timer);
  }, [standalone, installed, hasPrompt, ios, reading]);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* โหมดส่วนตัวอาจเขียน localStorage ไม่ได้ */
    }
  };

  const install = async () => {
    setStatus('working');
    const outcome = await promptInstall();
    setStatus('idle');
    if (outcome !== 'dismissed') setVisible(false);
    else dismiss();
  };

  if (!visible) return null;

  return (
    <aside className="pwa-install" role="dialog" aria-live="polite" aria-label="ติดตั้งแอป Nakhonmaesot Library">
      <button type="button" className="pwa-install-close" onClick={dismiss} aria-label="ปิดคำแนะนำการติดตั้ง">
        <Icon name="close" size={16} />
      </button>
      <span className="pwa-install-icon" aria-hidden="true">
        <Icon name="download" size={20} />
      </span>
      <div className="pwa-install-body">
        <strong>ติดตั้ง Nakhonmaesot Library</strong>
        {ios ? (
          <>
            <p>เพิ่มทางลัดบนหน้าจอโฮมเพื่อเปิดอ่านเต็มจอ และกลับมาใช้งานได้เร็วขึ้น</p>
            <ol className="pwa-install-steps">
              <li>
                แตะปุ่ม <Icon name="share" size={13} /> แชร์ ในแถบเบราว์เซอร์
              </li>
              <li>เลือก “เพิ่มไปยังหน้าจอโฮม”</li>
              <li>แตะ “เพิ่ม” เพื่อยืนยัน</li>
            </ol>
          </>
        ) : (
          <>
            <p>เพิ่มแอปบนหน้าจอโฮม เปิดอ่านได้เต็มจอ และเข้าถึงได้แม้สัญญาณไม่ดี</p>
            <div className="pwa-install-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={install} disabled={status === 'working'}>
                {status === 'working' ? 'กำลังติดตั้ง…' : 'ติดตั้งเลย'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
                ไว้ภายหลัง
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export function OfflineNotice() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let disposed = false;

    // หน้าเพจที่ถูกเสิร์ฟจากแคชตอนออฟไลน์อาจรายงาน navigator.onLine = true
    // จึงตรวจซ้ำด้วยการยิง request จริงไปที่ API
    const probe = async () => {
      if (navigator.onLine === false) {
        if (!disposed) setOffline(true);
        return;
      }
      try {
        await fetch('/api/health', { cache: 'no-store' });
        if (!disposed) setOffline(false);
      } catch {
        if (!disposed) setOffline(true);
      }
    };

    void probe();
    const goOffline = () => setOffline(true);
    const goOnline = () => void probe();
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    const timer = window.setInterval(() => {
      if (!document.hidden) void probe();
    }, 20000);

    return () => {
      disposed = true;
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      window.clearInterval(timer);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="offline-notice" role="status">
      <Icon name="globe" size={15} /> ออฟไลน์อยู่ — กำลังแสดงข้อมูลที่บันทึกไว้ในเครื่อง
    </div>
  );
}
