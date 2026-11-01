/** Effets visuels (DOM + CSS), bruitages et musique d'ambiance synthétisés (WebAudio, aucun fichier audio). */

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

/** Texte BD qui jaillit (POW!, CRASH!…). */
export const shout = (layer: HTMLElement, x: number, y: number, text: string, color: string) =>
  spawn(layer, 'float', x, y, text, { '--c': color }, 1100);

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
// Tout est synthétisé (WebAudio) : aucun fichier audio. Les pièces claquent comme sur un échiquier en bois
// (bruit court filtré + « toc » grave) ; l'ambiance est une boucle générative lente (nappes + notes de cloche).
let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
try { muted = localStorage.getItem('chrono-muted') === '1'; } catch { /* stockage indisponible */ }

const MUSIC_VOLUME = 0.5;

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('chrono-muted', m ? '1' : '0'); } catch { /* */ }
  applyMusic();
}

/** À appeler dans un geste utilisateur (règle des navigateurs) : crée le moteur audio et lance l'ambiance. */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      sfxBus = ctx.createGain();
      sfxBus.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(ctx.destination);
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    void ctx.resume();
    applyMusic();
  } catch { /* pas d'audio */ }
}

// --- Musique d'ambiance : Am - F - C - G, une mesure de 8 s par accord -------------
const CHORDS = [
  [110, 220, 261.63, 329.63], // La mineur
  [87.31, 174.61, 220, 261.63], // Fa
  [130.81, 261.63, 329.63, 392], // Do
  [98, 196, 246.94, 293.66], // Sol
];
const PENTATONIC = [440, 523.25, 587.33, 659.25, 783.99, 880]; // La mineur pentatonique
const BAR_SECONDS = 8;
let musicTimer: number | undefined;
let nextBarAt = 0;
let barIndex = 0;

/** Nappe douce : triangle filtré, attaque et relâchement lents. */
function pad(freq: number, at: number, dur: number, vol: number) {
  if (!ctx || !musicBus) return;
  const o = ctx.createOscillator();
  const lp = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  o.detune.value = (Math.random() - 0.5) * 10;
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + 2.2);
  g.gain.setValueAtTime(vol, at + dur - 2.2);
  g.gain.linearRampToValueAtTime(0.0001, at + dur);
  o.connect(lp).connect(g).connect(musicBus);
  o.start(at);
  o.stop(at + dur + 0.1);
}

/** Note de cloche : sinus avec une harmonique, décroissance longue. */
function bell(freq: number, at: number, vol: number) {
  if (!ctx || !musicBus) return;
  for (const [mult, v] of [[1, vol], [2, vol * 0.25]] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(v, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
    o.connect(g).connect(musicBus);
    o.start(at);
    o.stop(at + 2.7);
  }
}

function musicLoop() {
  if (!ctx || muted) { musicTimer = undefined; return; }
  nextBarAt = Math.max(nextBarAt, ctx.currentTime + 0.1);
  const chord = CHORDS[barIndex++ % CHORDS.length]!;
  chord.forEach((f, i) => pad(f, nextBarAt, BAR_SECONDS + 2.2, i === 0 ? 0.1 : 0.05));
  for (let n = 3 + Math.floor(Math.random() * 3); n > 0; n--) {
    bell(PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)]!, nextBarAt + 0.6 + Math.random() * (BAR_SECONDS - 1.8), 0.045);
  }
  nextBarAt += BAR_SECONDS;
  musicTimer = window.setTimeout(musicLoop, Math.max(500, (nextBarAt - ctx.currentTime - 1) * 1000));
}

/** Coupe ou rétablit l'ambiance (fondu) selon le réglage du son. */
function applyMusic() {
  if (!ctx || !musicBus) return;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setTargetAtTime(muted ? 0 : MUSIC_VOLUME, ctx.currentTime, 0.4);
  if (muted) { clearTimeout(musicTimer); musicTimer = undefined; }
  else if (musicTimer === undefined) musicLoop();
}

// --- Bruitages ------------------------------------------------------------------------
function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
  if (muted || !ctx || !sfxBus) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(sfxBus);
  o.start(t);
  o.stop(t + dur);
}

/** Claquement sec : bruit court passé dans un filtre passe-bande (le « clac » du bois). */
function knock(vol: number, freq: number, len: number, delay = 0, q = 1.4) {
  if (muted || !ctx || !sfxBus || !noise) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  const bp = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = noise;
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(bp).connect(g).connect(sfxBus);
  src.start(t, Math.random() * 0.1);
  src.stop(t + len + 0.02);
}

/** Une pièce qu'on pose : claquement + petit corps grave, avec une légère variation de hauteur. */
function piece(vol = 1, pitch = 1, delay = 0) {
  const p = pitch * (0.94 + Math.random() * 0.12);
  knock(0.9 * vol, 1750 * p, 0.06, delay);
  tone(175 * p, 0.09, 'sine', 0.3 * vol, 95 * p, delay);
}

export const sfx = {
  select: () => knock(0.14, 3200, 0.025, 0, 2),
  plan: () => piece(0.7),
  move: () => piece(1),
  capture: () => { knock(1.1, 1300, 0.1); tone(150, 0.16, 'sine', 0.4, 70); piece(0.9, 1.1, 0.06); },
  collision: () => { knock(1.2, 900, 0.14); tone(110, 0.4, 'sawtooth', 0.14, 40); tone(60, 0.5, 'square', 0.08, 30); piece(1, 0.8, 0.08); },
  fizzle: () => tone(420, 0.35, 'sawtooth', 0.07, 70),
  tick: () => tone(1000, 0.04, 'square', 0.05),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, undefined, i * 0.12)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, undefined, i * 0.14)),
};
