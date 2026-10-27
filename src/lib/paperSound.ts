const STORAGE_KEY = 'lumen-book-sound';

/**
 * The page-turn sound is synthesised with the Web Audio API instead of shipped as a
 * file: a short burst of noise swept through a band-pass filter reads as paper
 * rustling, and the sweep runs the other way when a page comes back. No asset, no
 * download, and it stays in sync with however long the turn animation runs.
 */
let context: AudioContext | null = null;

function readStored(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored !== 'off';
  } catch {
    return true;
  }
}

let enabled = typeof window !== 'undefined' ? readStored() : true;

export function isPageSoundOn() {
  return enabled;
}

export function setPageSoundOn(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the switch still works for this session */
  }
  if (!on) stopAll();
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!context) context = new Ctor();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function stopAll() {
  if (context && context.state !== 'closed') {
    // Voices are shorter than half a second, so letting them finish is inaudible;
    // suspending keeps a muted reader from holding the audio device open.
    void context.suspend();
  }
}

/** dir: 1 = the page travels forward, -1 = it comes back. */
export function playPageTurn(dir: 1 | -1 = 1) {
  if (!enabled) return;
  const ctx = ensureContext();
  if (!ctx || ctx.state === 'closed') return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const seconds = dir === 1 ? 0.62 : 0.5;
    const frames = Math.ceil(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Envelope: the sheet lifts, rustles through the air, then settles.
    for (let i = 0; i < frames; i += 1) {
      const t = i / frames;
      const swell = Math.sin(Math.PI * Math.pow(t, 0.75));
      const flutter = 0.7 + 0.3 * Math.sin(t * Math.PI * 26);
      data[i] = (Math.random() * 2 - 1) * swell * flutter;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.Q.value = 0.8;
    body.frequency.setValueAtTime(dir === 1 ? 780 : 1500, now);
    body.frequency.exponentialRampToValueAtTime(dir === 1 ? 2600 : 700, now + seconds * 0.55);
    body.frequency.exponentialRampToValueAtTime(600, now + seconds);

    const air = ctx.createBiquadFilter();
    air.type = 'highpass';
    air.frequency.value = 420;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(dir === 1 ? 0.5 : 0.34, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

    source.connect(body);
    body.connect(air);
    air.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + seconds + 0.02);
  } catch {
    /* audio is a nicety: never let it break a page turn */
  }
}
