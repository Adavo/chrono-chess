/** Effets visuels (DOM + CSS) et sons synthétisés (WebAudio, aucun fichier audio). */

// --- Visuels : coordonnées en % du plateau (0..100) ------------------------
function spawn(layer: HTMLElement, cls: string, x: number, y: number, html = '', vars: Record<string, string> = {}, life = 1000) {
  const el = document.createElement('div');
  el.className = `fx ${cls}`;
  el.style.left = x + '%';
  el.style.top = y + '%';
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.innerHTML = html;
  layer.appendChild(el);
  window.setTimeout(() => el.remove(), life);
}

/** Gerbe d'étincelles (capture). */
export function burst(layer: HTMLElement, x: number, y: number, color: string) {
  const w = layer.clientWidth || 400;
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = (0.06 + Math.random() * 0.12) * w;
    spawn(layer, 'spark', x, y, '', { '--dx': Math.cos(a) * d + 'px', '--dy': Math.sin(a) * d + 'px', '--c': color }, 800);
  }
}

/** Onde de choc (collision, promotion). */
export const ring = (layer: HTMLElement, x: number, y: number, color: string) =>
  spawn(layer, 'ring', x, y, '', { '--c': color }, 800);

/** Petit nuage de fumée + ✗ : le plan "fait pschitt". */
export function puff(layer: HTMLElement, x: number, y: number) {
  const w = layer.clientWidth || 400;
  for (let i = 0; i < 6; i++) {
    spawn(layer, 'smoke', x, y, '', {
      '--dx': (Math.random() - 0.5) * 0.12 * w + 'px', '--dy': -Math.random() * 0.1 * w + 'px',
      '--s': 0.6 + Math.random() * 0.8 + '',
    }, 1100);
  }
  spawn(layer, 'float', x, y, '✗', {}, 1200);
}

// --- Sons -----------------------------------------------------------------------
let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem('chrono-muted') === '1'; } catch { /* stockage indisponible */ }

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('chrono-muted', m ? '1' : '0'); } catch { /* */ }
}

/** À appeler dans un geste utilisateur (règle des navigateurs). */
export function unlockAudio() {
  try { ctx ??= new AudioContext(); void ctx.resume(); } catch { /* pas d'audio */ }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
  if (muted || !ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  select: () => tone(660, 0.07, 'triangle', 0.08),
  plan: () => { tone(520, 0.08, 'triangle', 0.1); tone(780, 0.1, 'triangle', 0.08, undefined, 0.06); },
  move: () => tone(300, 0.18, 'sine', 0.12, 180),
  capture: () => { tone(160, 0.25, 'sawtooth', 0.14, 60); tone(900, 0.1, 'square', 0.05, 200); },
  collision: () => { tone(110, 0.4, 'sawtooth', 0.18, 40); tone(60, 0.5, 'square', 0.1, 30); },
  fizzle: () => tone(420, 0.35, 'sawtooth', 0.07, 70),
  tick: () => tone(1000, 0.04, 'square', 0.05),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, undefined, i * 0.12)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, undefined, i * 0.14)),
};
