import './style.css';
import { LEVELS, type Level } from '../ai/ai';
import { thinkClassic, thinkPlan } from '../ai/think';
import { cloneState, createInitialState, rebuildGrid, sameSquare } from '../core/board';
import { gameOutcome, isInCheck, keepsKingSafe, snapshotOf } from '../core/check';
import { ClassicGame, turnOf, type ClassicMove } from '../core/classic';
import { checkMove, geometryReachable } from '../core/moves';
import { replaySteps } from '../core/replay';
import { resolveSubTurn } from '../core/resolution';
import { Game } from '../core/sequence';
import { DEFAULT_RULES, PROMOTIONS, type CancelReason, type Color, type GameEvent, type GameState, type PieceState, type PieceType, type Plan, type PlannedAction, type RulesConfig, type Square } from '../core/types';
import { dropPeer, host, join, type Conn } from '../net/peer';
import type { GuestToHost, HostToGuest, Variant } from '../net/transport';
import { burst, isMuted, puff, ring, setMuted, sfx, shout, unlockAudio } from './fx';
import { flagSvg, getLang, nextLang, setLang, t, type Key } from './i18n';
import { notate, sqName } from './notation';
import { pieceSvg } from './pieces';
import { VERSION_SHORT, checkForUpdate } from './version';

const SIZE = DEFAULT_RULES.size;
const VARIANTS: Variant[] = ['classic', 'single'];
const loadVariant = (): Variant => {
  try { const v = localStorage.getItem('chrono-variant'); if (v && (VARIANTS as string[]).includes(v)) return v as Variant; } catch { /* stockage indisponible */ }
  return 'classic';
};
/** Mode de jeu en cours (ou choisi sur l'accueil) et règles qui en découlent. */
let variant: Variant = loadVariant();
/**
 * Un seul coup par manche dans les deux modes (A : coups alternés, B : coups simultanés).
 * Le moteur sait gérer plusieurs coups par manche (`subTurns`) ; l'interface n'en propose plus.
 */
const rules: RulesConfig = { ...DEFAULT_RULES, subTurns: 1 };
const SUBS = rules.subTurns;
const CELL = 100 / SIZE; // largeur d'une case, en % du plateau
const PLAN_SECONDS = 5; // temps pour jouer son coup (dans les deux modes)
const LOW_MS = PLAN_SECONDS * 400; // dernière partie du chrono : barre rouge et tic-tac
const STEP_MS = 1100; // durée d'un sous-tour à l'écran
const DRAG_THRESHOLD = 6; // px avant qu'un appui devienne un glisser
const FILES = 'abcde';
const pieceName = (p: PieceType) => t(`piece_${p}` as Key);
const reasonText = (r: CancelReason) => t(`reason_${r}` as Key);
/** Codes d'erreur du transport réseau -> texte dans la langue courante. */
const errText = (code: string) => ({ 'no-peerjs': t('err_nopeer'), 'code-not-found': t('err_notfound'), timeout: t('err_timeout') } as Record<string, string>)[code] ?? code;

const app = document.getElementById('app')!;
type Mode = 'ai' | 'host' | 'guest';

// --- État de l'application ---------------------------------------------------
let mode: Mode = 'ai';
let aiLevel: Level = 'medium';
let me: Color = 'white';
let state: GameState = createInitialState();
let game: Game | null = null; // autoritaire : IA et hôte seulement (modes simultanés)
let cgame: ClassicGame | null = null; // idem pour le mode classique
let conn: Conn | null = null;
const emptyPlan = (): Plan => Array.from({ length: SUBS }, () => []);
let plan: Plan = emptyPlan();
/** Plan de l'IA (mode Bluff) : calculé pendant que le joueur réfléchit. */
let aiThinking: Promise<Plan> | null = null;
/** Coup en cours de programmation (0..SUBS-1). */
let activeSub = 0;
/** Nombre de coups programmés appliqués à l'affichage : le plateau montre la position prévue. */
let viewAt = 0;
let selected: string | null = null;
let deadline = 0;
let submitted = false;
let busy = false;
/** Les 5 coups sont placés : courte pause avant le lancement de la résolution. */
let finishing = false;
/** Identifie la résolution en cours : l'incrémenter annule ses animations différées (quitter, nouvelle partie). */
let runId = 0;
const FINISH_DELAY_MS = 1000;
let timer: number | undefined;
let logLines: LogLine[] = [];
let planBase: GameState = state; // position au début de la Séquence
let endReason: string | undefined; // raison de fin de partie (mat, pat) pour la bannière
let drag: { id: string; x: number; y: number; active: boolean; pointerId: number; again: boolean } | null = null;

const opp = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const flip = () => me === 'black';
/** Case logique -> colonne/ligne à l'écran (le joueur noir voit le plateau retourné). */
const disp = (s: Square) => ({ c: flip() ? SIZE - 1 - s.file : s.file, row: flip() ? s.rank : SIZE - 1 - s.rank });
const pct = (s: Square) => { const d = disp(s); return { x: (d.c + 0.5) * CELL, y: (d.row + 0.5) * CELL }; };
const dirOf = (c: Color): 1 | -1 => (c === 'white' ? 1 : -1);

// --- Références DOM de l'écran de jeu ---------------------------------------
let boardEl: HTMLElement, piecesEl: HTMLElement, fxEl: HTMLElement;
const pieceEls = new Map<string, HTMLElement>();

window.addEventListener('pointerdown', unlockAudio);

/** La hiérarchie des forces, en sprites : Roi > Tour > Cavalier > Fou > Pion. */
const rulesLegend = (cls = '') => `<div class="rules ${cls}">${(['K', 'R', 'N', 'B', 'P'] as PieceType[])
  .map((t) => `<span class="mini w">${pieceSvg(t)}</span>`).join('<i>&gt;</i>')}</div>`;

// --- Pied de page des menus : version (gauche), drapeau de langue (droite) ------
const foot = document.createElement('footer');
foot.id = 'foot';
document.body.appendChild(foot);

/** Bouton de son des menus (en haut à droite). */
const topSound = document.createElement('button');
topSound.id = 'top-sound';
topSound.className = 'icon';
document.body.appendChild(topSound);
topSound.onclick = () => { setMuted(!isMuted()); soundIcon(topSound); };

/** Affiche le pied de page ; `redraw` redessine l'écran courant quand on change de langue. `null` = masqué. */
function showFoot(redraw: (() => void) | null) {
  foot.hidden = topSound.hidden = !redraw;
  if (!redraw) return;
  soundIcon(topSound);
  foot.innerHTML = `<span class="version">${VERSION_SHORT}</span><button class="flag" id="lang" title="Language">${flagSvg(getLang())}</button>`;
  $('lang').onclick = () => { setLang(nextLang()); redraw(); };
}

// --- Menus -------------------------------------------------------------------
function showMenu(msg = '') {
  runId++; finishing = false; closeGameMenu();
  clearInterval(timer); dropPeer(); conn = null; game = null; cgame = null; busy = false;
  app.innerHTML = `<section class="menu-card">
    <div class="logo"><span class="piece-logo mini w">${pieceSvg('K')}</span><h1>Chrono Chess</h1></div>
    <div class="modes">${VARIANTS.map((v) => `<button class="mode ${v === variant ? 'on' : ''}" data-variant="${v}" aria-pressed="${v === variant}"><b>${t(`variant_${v}` as Key)}</b><small>${t(`variant_${v}_desc` as Key, { s: PLAN_SECONDS })}</small></button>`).join('')}</div>
    ${rulesLegend()}
    ${msg ? `<p class="error">${msg}</p>` : ''}
    <button class="primary" id="ai">${t('play_ai')}</button>
    <button id="host">${t('host_btn')}</button>
    <div class="row"><input id="code" placeholder="${t('code_ph')}" maxlength="5" autocomplete="off" /><button id="join">${t('join_btn')}</button></div>
  </section>`;
  showFoot(() => showMenu());
  document.querySelectorAll<HTMLElement>('[data-variant]').forEach((b) => (b.onclick = () => {
    variant = b.dataset.variant as Variant;
    try { localStorage.setItem('chrono-variant', variant); } catch { /* */ }
    showMenu();
  }));
  $('ai').onclick = showLevels;
  $('host').onclick = showHost;
  $('join').onclick = () => showJoin(($('code') as HTMLInputElement).value.trim());
}

/** Nouvelle partie contre l'IA, au niveau déjà choisi. */
function newAiGame() {
  runId++; finishing = false;
  mode = 'ai';
  me = variant === 'classic' && Math.random() < 0.5 ? 'black' : 'white'; // couleur tirée au sort en mode classique
  startLocalGame();
}

/** Crée la partie autoritaire (IA ou hôte) du mode courant et lance le premier tour. */
function startLocalGame() {
  if (variant === 'classic') { cgame = new ClassicGame(createInitialState()); game = null; state = cgame.state; }
  else { game = new Game(createInitialState(), rules); cgame = null; state = game.state; }
  buildGame();
  beginTurn();
}

const beginTurn = () => (variant === 'classic' ? startClassicTurn() : startPlanning());

/** Petite couronne pixel art (Grand Maître). */
const CROWN = `<svg class="crown" viewBox="0 0 9 6" shape-rendering="crispEdges" aria-hidden="true">${['#...#...#', '##.###.##', '#########', '#########', '#########']
  .flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ''))).join('')}</svg>`;

/** Second menu : niveau de l'IA. */
function showLevels() {
  app.innerHTML = `<section class="menu-card">
    <h1 class="small">${t('level_title')}</h1>
    ${LEVELS.map((l) => `<button class="level ${l === 'master' ? 'master' : ''}" data-level="${l}"><b>${l === 'master' ? CROWN : ''}${t(`level_${l}` as Key)}</b><small>${t(`level_${l}_desc` as Key)}</small></button>`).join('')}
    <button id="back">${t('back')}</button>
  </section>`;
  showFoot(showLevels);
  document.querySelectorAll<HTMLElement>('[data-level]').forEach((b) => (b.onclick = () => {
    aiLevel = b.dataset.level as Level;
    newAiGame();
  }));
  $('back').onclick = () => showMenu();
}

function showHost() {
  showFoot(null);
  app.innerHTML = `<section class="menu-card"><h1 class="small">${t('online_title')}</h1><p>${t('give_code')} <span class="hint">${t('click_copy')}</span></p>
    <div class="code" id="c">· · · · ·</div><p id="st" class="hint">${t('creating')}</p>
    <div class="row" id="share" hidden><button id="copylink">${t('share_copy')}</button>${'share' in navigator ? `<button id="share-btn">${t('share')}</button>` : ''}</div>
    <button id="back">${t('cancel')}</button></section>`;
  $('back').onclick = () => showMenu();
  host(
    (code) => {
      // Lien de partage : l'invité n'a qu'à l'ouvrir pour rejoindre (pas de code à recopier).
      const link = `${location.origin}${location.pathname}?join=${code}`;
      $('c').textContent = code; $('st').textContent = t('waiting_opp'); $('share').hidden = false;
      $('c').onclick = () => navigator.clipboard?.writeText(code).then(() => ($('st').textContent = t('copied')));
      $('copylink').onclick = () => navigator.clipboard?.writeText(link).then(() => ($('st').textContent = t('link_copied')));
      const shareBtn = document.getElementById('share-btn');
      if (shareBtn) shareBtn.onclick = () => void navigator.share({ title: 'Chrono Chess', text: t('share_text'), url: link }).catch(() => { /* annulé */ });
    },
    (c) => {
      mode = 'host'; conn = c;
      me = variant === 'classic' && Math.random() < 0.5 ? 'black' : 'white'; // couleur tirée au sort en mode classique
      c.onmsg = (m: GuestToHost) => {
        if (m.t === 'plan' && game && m.seq === game.state.sequence) { // un plan périmé est ignoré
          game.submitPlan(opp(me), m.plan);
          if (submitted) hostResolve();
        } else if (m.t === 'move' && cgame && m.seq === cgame.state.sequence && turnOf(state) !== me) {
          applyClassic(opp(me), m.move);
        }
      };
      c.onclose = () => showMenu(t('lost_opp'));
      startLocalGame();
      c.send({ t: 'start', color: opp(me), state, variant } satisfies HostToGuest);
    },
    (e) => showMenu(errText(e)),
  );
}

function showJoin(code: string) {
  if (code.length < 5) return showMenu(t('enter_code'));
  showFoot(null);
  app.innerHTML = `<section class="menu-card"><h1 class="small">${t('connecting')}</h1><div class="code">${code.toUpperCase()}</div></section>`;
  join(code, (c) => {
    mode = 'guest'; conn = c;
    c.onmsg = (m: HostToGuest) => {
      if (m.t === 'start') { variant = m.variant ?? 'classic'; me = m.color; state = m.state; buildGame(); beginTurn(); }
      if (m.t === 'resolved') playResolution(m.events, m.state);
    };
    c.onclose = () => showMenu(t('lost_host'));
  }, (e) => showMenu(errText(e)));
}

// --- Construction de l'écran de jeu ------------------------------------------
function buildGame() {
  showFoot(null);
  pieceEls.clear(); logLines = []; drag = null;
  const squares: string[] = [];
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
    const f = flip() ? SIZE - 1 - col : col;
    const r = flip() ? row : SIZE - 1 - row;
    const fileLabel = row === SIZE - 1 ? `<i class="co f">${FILES[f]}</i>` : '';
    const rankLabel = col === 0 ? `<i class="co r">${r + 1}</i>` : '';
    squares.push(`<div class="sq ${(f + r) % 2 ? 'l' : 'd'}" data-f="${f}" data-r="${r}">${fileLabel}${rankLabel}</div>`);
  }
  app.innerHTML = `
    <header class="top">
      <div class="who"><span class="dot ${me}"></span><span id="status"></span></div>
      <div class="right"><span class="clock" id="clock"></span><button class="icon" id="gm-sound"></button><button class="icon" id="menu-btn" title="${t('menu')}" aria-label="${t('menu')}">${MENU_ICON}</button></div>
      <div class="gamemenu" id="gmenu" hidden>
        <div class="gm-title">${t('history')}</div>
        <div class="log" id="log"></div>
        ${mode === 'ai' ? `<button id="gm-new">${t('menu_new')}</button>` : ''}
        <button id="gm-quit">${t('menu_quit')}</button>
      </div>
    </header>
    <div class="timebar"><i id="timebar"></i></div>
    <div class="boardwrap">
      <div class="board" id="board">${squares.join('')}
        <div class="layer" id="pieces"></div>
        <div class="layer" id="fx" style="z-index:6"></div>
        <div class="banner" id="banner" hidden></div>
      </div>
    </div>
    <div class="row actions" id="actions" hidden><button class="primary" id="ok">${t('see_result')}</button></div>`;
  boardEl = $('board'); piecesEl = $('pieces'); fxEl = $('fx');

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('pointercancel', () => endDrag(false, null));
  // Partie terminée : le bouton rouvre la bannière de résultat.
  $('ok').onclick = () => { $('banner').hidden = false; };
  const soundBtn = $('gm-sound');
  const paintSound = () => soundIcon(soundBtn);
  paintSound();
  $('menu-btn').onclick = () => { paintSound(); $('gmenu').hidden = !$('gmenu').hidden; renderLog(); };
  soundBtn.onclick = () => { setMuted(!isMuted()); paintSound(); closeGameMenu(); };
  $('gm-quit').onclick = () => showMenu();
  if (mode === 'ai') $('gm-new').onclick = () => newAiGame();
}

/** Menu de partie : se ferme quand on touche ailleurs. */
const closeGameMenu = () => { const m = document.getElementById('gmenu'); if (m) m.hidden = true; };
window.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('#gmenu, #menu-btn')) closeGameMenu();
});

/** Haut-parleur pixel art : ondes = son activé, croix = son coupé. */
const SPEAKER = '<rect y="3" width="3" height="4"/><polygon points="3,3 6,0 6,10 3,7"/>';
const SOUND_ON = `<svg viewBox="0 0 12 10" shape-rendering="crispEdges" aria-hidden="true">${SPEAKER}<rect x="8" y="3" width="1" height="4"/><rect x="10" y="1" width="1" height="8"/></svg>`;
const SOUND_OFF = `<svg viewBox="0 0 12 10" shape-rendering="crispEdges" aria-hidden="true">${SPEAKER}<path d="M8 3L12 7M12 3L8 7" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`;
/** Icône et infobulle d'un bouton de son, selon l'état (coupé ou non). */
function soundIcon(btn: HTMLElement) {
  btn.innerHTML = isMuted() ? SOUND_OFF : SOUND_ON;
  btn.title = t(isMuted() ? 'sound_on' : 'sound_off');
  btn.setAttribute('aria-label', btn.title);
}
const MENU_ICON = `<svg viewBox="0 0 12 10" shape-rendering="crispEdges" aria-hidden="true"><rect width="12" height="2"/><rect y="4" width="12" height="2"/><rect y="8" width="12" height="2"/></svg>`;

const locked = () => busy || submitted || finishing || !!state.winner || (variant === 'classic' && turnOf(state) !== me);

// --- Prévisualisation : le vrai moteur, l'adversaire restant immobile --------
/**
 * Dois-je d'abord sortir d'échec ? Seul le 1er coup le sait avec certitude (mon roi est en échec au début de la
 * manche). Ensuite l'adversaire aura bougé : l'interface ne l'impose plus, le moteur annulera au besoin.
 */
function mustEscape(states: GameState[], at: number): boolean {
  return at === 0 && isInCheck(states[0]!.pieces, SIZE, me);
}

/**
 * Coup que le moteur annulerait sur la position prévue (adversaire supposé immobile) mais que le joueur espère
 * possible : on l'applique « si tout se passe bien » pour que l'aperçu et les coups suivants restent cohérents.
 */
function optimisticStep(s: GameState, a: PlannedAction): GameState {
  const next = cloneState(s);
  const p = next.pieces.find((q) => q.id === a.pieceId);
  if (!p) return s;
  const target = next.pieces.find((q) => q.color !== p.color && sameSquare(q.pos, a.to));
  if (target?.type === 'K') return s; // un roi ne se capture pas
  // Contre-prise : une de mes pièces est sur la case visée ; on suppose que l'adversaire l'y a prise.
  const lost = next.pieces.find((q) => q !== p && q.color === p.color && sameSquare(q.pos, a.to));
  next.pieces = next.pieces.filter((q) => q !== target && q !== lost);
  p.pos = { ...a.to };
  if (p.type === 'P' && p.pos.rank === (p.color === 'white' ? SIZE - 1 : 0)) p.type = a.promo ?? 'N';
  rebuildGrid(next);
  return next;
}

/** states[n] = position après mes n premiers coups, « si tout se passe bien » (un coup caduc n'a plus besoin de l'être). */
function previewStates(): GameState[] {
  const out: GameState[] = [planBase];
  for (let t = 0; t < SUBS; t++) {
    const a = plan[t]![0];
    if (!a) { out.push(out[t]!); continue; }
    const escape = new Set<Color>(mustEscape(out, t) ? [me] : []);
    const res = resolveSubTurn(out[t]!, t, [{ ...a, subTurn: t, owner: me, order: 0 }], () => 0, escape);
    out.push(res.events.some((e) => e.kind === 'cancelled') ? optimisticStep(out[t]!, a) : res.state);
  }
  return out;
}

/** Message d'état pendant la planification. */
function planStatus(view: GameState, escape: boolean): string {
  if (escape) return t('status_escape');
  if (isInCheck(view.pieces, SIZE, me)) return t('status_check_now');
  if (viewAt === SUBS) {
    const out = gameOutcome(view.pieces, SIZE);
    if (out?.reason === 'checkmate' && out.winner === me) return t('status_mate');
  }
  if (isInCheck(view.pieces, SIZE, opp(me))) return t('status_check_opp');
  return t('status_plan_one');
}

// --- Pièces (éléments persistants : elles glissent d'une case à l'autre) -----
function syncPieces(list: PieceState[], ghosts: ReadonlySet<string> = new Set()) {
  const alive = new Set(list.map((p) => p.id));
  for (const p of list) {
    let el = pieceEls.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = `piece ${p.color === 'white' ? 'w' : 'b'}`;
      piecesEl.appendChild(el);
      pieceEls.set(p.id, el);
    }
    if (el.dataset.type !== p.type) { el.dataset.type = p.type; el.innerHTML = `<div class="inner">${pieceSvg(p.type)}</div>`; }
    const d = disp(p.pos);
    el.style.setProperty('--c', String(d.c));
    el.style.setProperty('--r', String(d.row));
    el.classList.toggle('covered', ghosts.has(p.id));
    el.classList.toggle('check', p.type === 'K' && !ghosts.has(p.id) && isInCheck(list.filter((q) => !ghosts.has(q.id)), SIZE, p.color));
  }
  for (const [id, el] of [...pieceEls]) if (!alive.has(id)) { pieceEls.delete(id); el.remove(); }
}

/** Remet les pièces à leur position réelle sans animation (avant de jouer la résolution). */
function snapPieces(list: PieceState[]) {
  piecesEl.classList.add('noanim');
  syncPieces(list);
  void piecesEl.offsetWidth;
  piecesEl.classList.remove('noanim');
}

// --- Interface de planification ----------------------------------------------
function refreshPlanUi() {
  const over = state.winner;
  const preview = !busy && !over;
  const states = previewStates();
  const view = preview ? states[viewAt]! : state;

  $('status').textContent = over ? (over === 'draw' ? t('draw') : over === me ? t('win') : t('lose'))
    : busy ? t('resolving') : submitted ? t('plan_sent')
    : variant === 'classic' ? (turnOf(state) !== me ? t('opp_turn') : mustEscape(states, viewAt) ? t('status_escape') : t('your_turn'))
    : planStatus(view, mustEscape(states, viewAt));

  // Une pièce adverse qui serait mangée si tout se passe bien reste affichée en transparence.
  const alive = new Set(view.pieces.map((q) => q.id));
  const ghosts = preview ? planBase.pieces.filter((q) => q.color !== me && !alive.has(q.id)) : [];
  if (preview && !drag?.active) syncPieces([...view.pieces, ...ghosts], new Set(ghosts.map((q) => q.id)));

  // Cases : sélection + aides
  boardEl.querySelectorAll('.sq').forEach((el) => el.classList.remove('sel', 'hint', 'hint-cap', 'hint-soft'));
  piecesEl.querySelectorAll('.piece').forEach((el) => el.classList.remove('selected'));
  const esc = mustEscape(states, viewAt);
  const p = selected && preview && !locked() ? view.pieces.find((q) => q.id === selected) : undefined;
  if (p) {
    sqEl(p.pos)?.classList.add('sel');
    pieceEls.get(p.id)?.classList.add('selected');
    const snap = snapshotOf(view.pieces, SIZE);
    for (let f = 0; f < SIZE; f++) for (let r = 0; r < SIZE; r++) {
      const to = { file: f, rank: r };
      if (!isLegalTarget(view, p, to, viewAt === 0, esc)) continue;
      const c = checkMove(snap, p, to, dirOf(me));
      const cls = !c.ok ? 'hint-soft' : c.capture ? 'hint-cap' : 'hint';
      sqEl(to)?.classList.add(cls);
    }
  }

  // Partie finie : le bouton du bas permet de revoir le résultat, plateau visible.
  $('actions').hidden = !over; // le coup part tout seul (dès qu'il est joué, ou à la fin du chrono) : le bouton ne sert qu'à revoir le résultat
  ($('ok') as HTMLButtonElement).disabled = busy;
}

/** Redessine le journal (seulement quand il change, pas à chaque rafraîchissement du plateau). */
function renderLog() {
  const log = $('log');
  log.innerHTML = logHtml();
  log.scrollTop = log.scrollHeight;
}

/**
 * Destination proposée par l'interface.
 * - 1er coup : la position est connue, on n'accepte que ce que le moteur validerait (trajectoire libre, pion qui capture
 *   une vraie cible, roi jamais sur une case attaquée, sortie d'échec si le roi l'est au départ).
 * - À partir du 2e coup : l'adversaire aura bougé, donc tout ce qui est géométriquement possible est proposé
 *   y compris une case occupée par l'une de mes pièces (contre-prise : l'adversaire l'y aura peut-être prise) ;
 *   si le coup est vraiment illégal, il sera annulé à la résolution.
 */
function isLegalTarget(view: GameState, p: PieceState, to: Square, first: boolean, escape: boolean): boolean {
  if (!geometryReachable(p, to, SIZE, dirOf(me))) return false;
  if (!first) return true;
  if (view.pieces.some((q) => q.color === me && sameSquare(q.pos, to))) return false; // 1er coup : case alliée certaine
  const snap = snapshotOf(view.pieces, SIZE);
  if (!checkMove(snap, p, to, dirOf(me)).ok) return false;
  if (snap.at(to)?.type === 'K') return false; // un roi ne se capture pas
  return !(escape || variant === 'classic' || p.type === 'K') || keepsKingSafe(view.pieces, SIZE, p, to); // le roi évite toujours les cases attaquées
}

const sqEl = (s: Square) => document.querySelector<HTMLElement>(`.sq[data-f="${s.file}"][data-r="${s.rank}"]`);

/** Enregistre le coup du sous-tour actif : la pièce se déplace à l'écran. */
function place(id: string, to: Square) {
  if (variant === 'classic') { playMyClassic({ pieceId: id, to }); return; }
  // Promotion : la pièce est tirée au sort maintenant, montrée dans l'aperçu et reprise telle quelle à la résolution.
  const pawn = previewStates()[viewAt]!.pieces.find((q) => q.id === id);
  const promo = pawn?.type === 'P' && to.rank === (me === 'white' ? SIZE - 1 : 0) ? PROMOTIONS[Math.floor(Math.random() * PROMOTIONS.length)] : undefined;
  plan[activeSub] = [{ pieceId: id, to, ...(promo ? { promo } : {}) }].slice(0, DEFAULT_RULES.maxActionsPerSubTurn);
  sfx.plan();
  selected = null;
  viewAt = activeSub + 1;
  activeSub = Math.min(activeSub + 1, SUBS - 1);
  // Tous les coups sont programmés : validation automatique après une petite pause (inutile d'attendre la fin du chrono).
  if (plan.every((a) => a.length > 0)) {
    finishing = true;
    refreshPlanUi();
    const run = runId;
    window.setTimeout(() => { if (run !== runId) return; finishing = false; submit(); }, FINISH_DELAY_MS);
    return;
  }
  refreshPlanUi();
}

// --- Souris / tactile : clic-clic et glisser-déposer --------------------------
function squareAt(ev: PointerEvent): Square | null {
  const rect = boardEl.getBoundingClientRect();
  const col = Math.floor(((ev.clientX - rect.left) / rect.width) * SIZE);
  const row = Math.floor(((ev.clientY - rect.top) / rect.height) * SIZE);
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return null;
  return { file: flip() ? SIZE - 1 - col : col, rank: flip() ? row : SIZE - 1 - row };
}

function onPointerDown(ev: PointerEvent) {
  if (locked() || ev.button > 0) return;
  // Si l'affichage montre le résultat du dernier coup, on revient d'abord au sous-tour actif.
  if (viewAt !== activeSub) { viewAt = activeSub; selected = null; refreshPlanUi(); return; }
  const sq = squareAt(ev); if (!sq) return;
  const states = previewStates();
  const view = states[viewAt]!;
  const esc = mustEscape(states, viewAt);
  const mine = view.pieces.find((p) => p.color === me && sameSquare(p.pos, sq));
  // clic-clic : destination d'une pièce déjà sélectionnée (même sur une de mes pièces : contre-prise)
  const p = selected ? view.pieces.find((q) => q.id === selected) : undefined;
  if (p && p.id !== mine?.id && isLegalTarget(view, p, sq, viewAt === 0, esc)) { place(p.id, sq); return; }
  if (mine) {
    // un second appui sur la pièce déjà sélectionnée la désélectionne (au relâchement, sans glisser)
    const again = mine.id === selected;
    selected = mine.id; if (!again) sfx.select();
    drag = { id: mine.id, x: ev.clientX, y: ev.clientY, active: false, pointerId: ev.pointerId, again };
    refreshPlanUi();
  }
}

function onPointerMove(ev: PointerEvent) {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < DRAG_THRESHOLD) return;
    drag.active = true;
    boardEl.setPointerCapture(drag.pointerId);
    pieceEls.get(drag.id)?.classList.add('dragging');
  }
  const rect = boardEl.getBoundingClientRect();
  const el = pieceEls.get(drag.id);
  el?.style.setProperty('--c', String((ev.clientX - rect.left) / rect.width * SIZE - 0.5));
  el?.style.setProperty('--r', String((ev.clientY - rect.top) / rect.height * SIZE - 0.5));
}

function onPointerUp(ev: PointerEvent) { endDrag(true, ev); }

function endDrag(drop: boolean, ev: PointerEvent | null) {
  const d = drag; drag = null;
  if (!d) return;
  const el = pieceEls.get(d.id);
  el?.classList.remove('dragging');
  if (!d.active) { if (d.again) { selected = null; refreshPlanUi(); } return; } // simple clic : sélectionne, ou désélectionne au second
  try { boardEl.releasePointerCapture(d.pointerId); } catch { /* déjà relâché */ }
  const sq = drop && ev ? squareAt(ev) : null;
  const states = previewStates();
  const view = states[viewAt]!;
  const p = view.pieces.find((q) => q.id === d.id)!;
  if (sq && isLegalTarget(view, p, sq, viewAt === 0, mustEscape(states, viewAt))) {
    place(d.id, sq);
  } else {
    refreshPlanUi(); // retour à la case d'origine
  }
}

// --- Cycle de jeu --------------------------------------------------------------
/** Chronomètre (PLAN_SECONDS) : barre, compte à rebours, tic-tac final ; `onExpire` à l'échéance. */
function startClock(onExpire: () => void) {
  deadline = Date.now() + PLAN_SECONDS * 1000;
  clearInterval(timer);
  let lastTick = -1;
  timer = window.setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    $('clock').textContent = (left / 1000).toFixed(1);
    const bar = $('timebar') as HTMLElement;
    bar.style.width = (left / (PLAN_SECONDS * 1000)) * 100 + '%';
    bar.classList.toggle('low', left < LOW_MS);
    const s = Math.ceil(left / 1000);
    if (left < LOW_MS && s !== lastTick && left > 0) { lastTick = s; sfx.tick(); }
    if (left <= 0) { clearInterval(timer); onExpire(); }
  }, 100);
}

/** Exécute `fn` plus tard, sauf si la partie a été quittée / relancée / un coup a été joué entre-temps. */
function defer(fn: () => void, ms: number) {
  const run = runId;
  window.setTimeout(() => { if (run === runId) fn(); }, ms);
}

function startPlanning() {
  plan = emptyPlan(); activeSub = 0; viewAt = 0; selected = null; drag = null;
  submitted = false; busy = false; finishing = false;
  planBase = state;
  $('banner').hidden = true;
  aiThinking = mode === 'ai' ? thinkPlan(state, opp(me), rules, aiLevel) : null;
  startClock(submit);
  snapPieces(state.pieces);
  refreshPlanUi();
}

// --- Mode classique : un coup à la fois, chrono par coup ---------------------------------
function startClassicTurn() {
  plan = emptyPlan(); activeSub = 0; viewAt = 0; selected = null; drag = null;
  submitted = false; busy = false; finishing = false;
  planBase = state;
  $('banner').hidden = true;
  const mineToPlay = turnOf(state) === me;
  startClock(() => {
    if (!mineToPlay || busy || submitted) return; // le tour adverse est géré par l'IA ou par l'hôte
    if (mode === 'guest') { submitted = true; refreshPlanUi(); return; } // l'hôte jouera un coup au hasard à ma place
    const m = randomMove(me);
    if (m) playMyClassic(m);
  });
  snapPieces(state.pieces);
  refreshPlanUi();
  if (mineToPlay) return;
  if (mode === 'ai') {
    // L'IA réfléchit dans un Worker ; on garde un petit délai minimum pour que son coup reste lisible.
    const run = runId, start = Date.now(), minDelay = 450 + Math.random() * 450;
    void thinkClassic(state, opp(me), aiLevel).then((m) => {
      if (run !== runId || !m) return;
      defer(() => applyClassic(opp(me), m), Math.max(0, minDelay - (Date.now() - start)));
    });
  } else if (mode === 'host') defer(() => { const m = randomMove(opp(me)); if (m) applyClassic(opp(me), m); }, PLAN_SECONDS * 1000 + 700); // fin du chrono adverse
}

const randomMove = (color: Color): ClassicMove | null => cgame?.randomMove(color) ?? null;

/** Mon coup en mode classique : envoyé à l'hôte (invité) ou appliqué directement (IA, hôte). */
function playMyClassic(move: ClassicMove) {
  if (busy || submitted || state.winner || turnOf(state) !== me) return;
  submitted = true; selected = null; clearInterval(timer);
  if (mode === 'guest') { conn!.send({ t: 'move', move, seq: state.sequence } satisfies GuestToHost); refreshPlanUi(); return; }
  applyClassic(me, move);
}

/** Applique un coup sur la partie autoritaire (IA, hôte), le diffuse à l'invité, puis l'anime. */
function applyClassic(color: Color, move: ClassicMove) {
  if (!cgame || busy) return;
  const before = cgame.state;
  const events = cgame.play(color, move);
  if (!events) return;
  conn?.send({ t: 'resolved', events, state: cgame.state } satisfies HostToGuest);
  state = before;
  playResolution(events, cgame.state);
}

function submit() {
  if (submitted || busy || state.winner) return;
  submitted = true; clearInterval(timer); selected = null; viewAt = SUBS;
  if (drag?.active) endDrag(false, null);
  $('clock').textContent = '';
  if (mode === 'ai') {
    game!.submitPlan(me, plan);
    const run = runId;
    void aiThinking?.then((p) => { if (run !== runId || !game) return; game.submitPlan(opp(me), p); hostResolve(); });
  } else if (mode === 'host') {
    game!.submitPlan(me, plan);
    if (game!.ready) hostResolve();
    else {
      // L'adversaire a 4 s de grâce, sinon plan vide (sans effet si la Séquence est déjà résolue).
      const seq = game!.state.sequence;
      window.setTimeout(() => game && game.state.sequence === seq && hostResolve(), 4000);
    }
  } else {
    conn!.send({ t: 'plan', plan, seq: state.sequence } satisfies GuestToHost);
  }
  refreshPlanUi();
}

function hostResolve() {
  if (!game || busy) return;
  const before = game.state;
  const events = game.resolve();
  conn?.send({ t: 'resolved', events, state: game.state } satisfies HostToGuest);
  state = before;
  playResolution(events, game.state);
}

// --- Résolution (cinématique) ----------------------------------------------
/** Ligne de journal : `n` = numéro du coup, `side` = colonne (blancs / noirs) ; sans `side`, ligne pleine largeur. */
interface LogLine { text: string; cls?: string; n?: number; side?: Color }

function describe(e: GameEvent, before: GameState, stepEvents: GameEvent[]): LogLine | null {
  const piece = (id: string) => before.pieces.find((q) => q.id === id);
  // Numérotation continue sur toute la partie : manche 1 = coups 1 à 5, manche 2 = coups 6 à 10…
  const n = variant === 'classic' ? Math.floor(before.sequence / 2) + 1 : before.sequence * SUBS + (e as { subTurn: number }).subTurn + 1;
  switch (e.kind) {
    case 'move': {
      const p = piece(e.pieceId);
      if (!p) return null;
      const capture = stepEvents.some((x) => (x.kind === 'capture' && x.attackerId === p.id) || (x.kind === 'collision' && (x.winnerId === p.id || (p.type === 'P' && e.to.file !== p.pos.file && x.pieceIds.includes(p.id)))));
      const promo = stepEvents.find((x) => x.kind === 'promotion' && x.pieceId === p.id);
      return { n, side: p.color, text: notate(p, e.to, before, capture, promo?.kind === 'promotion' ? promo.to : undefined), cls: capture ? 'cap' : undefined };
    }
    case 'cancelled': {
      const p = piece(e.pieceId);
      // Coup impossible : juste le ✗ (la raison n'apparaît qu'au survol).
      return { n, side: e.owner, text: `<span title="${reasonText(e.reason)}">✗ ${p ? notate(p, e.to, before, false) : sqName(e.to)}</span>`, cls: 'cancel' };
    }
    case 'game-over': {
      const score = e.winner === 'draw' ? '½-½' : e.winner === 'white' ? '1-0' : '0-1';
      return { text: `${e.reason === 'checkmate' ? '# ' : ''}${endText(e.winner, e.reason)} ${score}`, cls: 'cap' };
    }
    default: return null; // capture, promotion, choc, échec : déjà dans la notation du coup ou inutiles ici
  }
}

/** Journal sur deux colonnes : une ligne par coup, blancs à gauche, noirs à droite. */
function logHtml(): string {
  const rows = new Map<number, { white: string[]; black: string[]; full: string[] }>();
  const tail: string[] = [];
  const cell = (l: LogLine) => `<div class="${l.cls ?? ''}">${l.text}</div>`;
  for (const l of logLines) {
    if (l.n === undefined) { tail.push(`<div class="lfull ${l.cls ?? ''}">${l.text}</div>`); continue; }
    const row = rows.get(l.n) ?? { white: [], black: [], full: [] };
    rows.set(l.n, row);
    (l.side ? row[l.side] : row.full).push(l.side ? cell(l) : `<div class="lfull ${l.cls ?? ''}">${l.text}</div>`);
  }
  const body = [...rows.entries()].sort((a, b) => a[0] - b[0])
    .map(([n, r]) => `<div class="lrow ${n % 2 ? 'odd' : ''}"><b>${n}.</b><div>${r.white.join('')}</div><div>${r.black.join('')}</div></div>${r.full.join('')}`).join('');
  return `${body}${tail.join('')}`;
}

function endText(winner: Color | 'draw', reason?: string): string {
  if (reason === 'stalemate') return t('end_stalemate');
  if (reason === 'insufficient') return t('end_insufficient');
  if (reason === 'repetition') return t('end_repetition');
  if (winner === 'draw') return reason === 'checkmate' ? t('end_double') : t('end_draw');
  return t(winner === 'white' ? 'end_mate_white' : 'end_mate_black');
}

function playResolution(events: GameEvent[], finalState: GameState) {
  const run = ++runId;
  const later = (fn: () => void, ms: number) => window.setTimeout(() => { if (run === runId) fn(); }, ms);
  const classic = variant === 'classic';
  const stepMs = classic ? 800 : STEP_MS;
  const impactMs = classic ? 380 : 520;
  busy = true; clearInterval(timer); selected = null; drag = null; endReason = undefined;
  $('clock').textContent = ''; ($('timebar') as HTMLElement).style.width = '0%';
  snapPieces(state.pieces); // les pièces quittent la position "prévue" pour la position réelle
  const steps = replaySteps(state, events);
  let i = 0;
  const next = () => {
    const step = steps[i++];
    if (!step) { later(finish, classic ? 250 : 700); return; }
    const before = state;
    for (const e of step.events) { const d = describe(e, before, step.events); if (d) logLines.push(d); if (e.kind === 'game-over') endReason = e.reason; }
    renderLog();

    // 1. Coups caducs : la pièce tremble, un nuage de fumée, rien ne bouge.
    for (const e of step.events) if (e.kind === 'cancelled') {
      const p = before.pieces.find((q) => q.id === e.pieceId);
      if (p) {
        const c = pct(p.pos); puff(fxEl, c.x, c.y); sfx.fizzle();
        const inner = pieceEls.get(p.id)?.querySelector('.inner');
        inner?.classList.add('wobble'); later(() => inner?.classList.remove('wobble'), 700);
      }
    }
    // 2. Déplacements : les pièces glissent (simultanément).
    state = step.state;
    for (const e of step.events) if (e.kind === 'move') {
      const inner = pieceEls.get(e.pieceId)?.querySelector('.inner');
      inner?.classList.add('lift'); later(() => inner?.classList.remove('lift'), 600);
    }
    if (step.events.some((e) => e.kind === 'move')) sfx.move();
    // Les victimes glissent jusqu'à la case du choc (si elles bougeaient) avant de disparaître.
    const survivors = new Set(state.pieces.map((p) => p.id));
    const dyingList = before.pieces.filter((p) => !survivors.has(p.id)).map((p) => {
      const mv = step.events.find((e) => e.kind === 'move' && e.pieceId === p.id);
      return mv && mv.kind === 'move' ? { ...p, pos: { ...mv.to } } : p;
    });
    syncPieces([...state.pieces, ...dyingList]);
    refreshPlanUi();

    // 3. Impacts, un peu après l'arrivée.
    later(() => {
      for (const e of step.events) {
        if (e.kind === 'capture' || e.kind === 'collision') {
          const c = pct(e.at);
          const col = e.kind === 'collision' ? '#ffb04c' : '#ff5a6e';
          burst(fxEl, c.x, c.y, col);
          shout(fxEl, c.x, c.y, e.kind === 'collision' ? 'CRASH!' : 'POW!', col);
          if (e.kind === 'collision') { ring(fxEl, c.x, c.y, col); sfx.collision(); } else sfx.capture();
          boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
        }
        if (e.kind === 'promotion') { const c = pct(e.at); ring(fxEl, c.x, c.y, '#7dffb0'); shout(fxEl, c.x, c.y, pieceName(e.to).toUpperCase() + '!', '#7dffb0'); }
      }
      for (const p of dyingList) {
        const el = pieceEls.get(p.id);
        el?.querySelector('.inner')?.classList.add('die');
        later(() => { el?.remove(); pieceEls.delete(p.id); }, 520);
      }
    }, impactMs);
    later(next, stepMs);
  };
  const finish = () => {
    state = finalState; busy = false;
    syncPieces(state.pieces); refreshPlanUi();
    if (state.winner) {
      const ban = $('banner'); const won = state.winner === me;
      ban.innerHTML = `<h2>${state.winner === 'draw' ? t('draw') : won ? t('win') : t('lose')}</h2><p>${endText(state.winner, endReason)}</p><button class="primary" id="view">${t('view_board')}</button><button id="menu">${t('to_menu')}</button>`;
      ban.className = `banner ${state.winner === 'draw' ? '' : won ? 'win' : 'lose'}`; ban.hidden = false;
      $('menu').onclick = () => showMenu();
      $('view').onclick = () => { ban.hidden = true; };
      state.winner === me ? sfx.win() : sfx.lose();
    } else beginTurn();
  };
  refreshPlanUi();
  later(next, classic ? 120 : 400);
}

function $(id: string): HTMLElement { return document.getElementById(id)!; }

// Lien d'invitation (?join=CODE) : on rejoint directement la partie, sans passer par l'accueil.
const inviteCode = new URLSearchParams(location.search).get('join');
if (inviteCode) { history.replaceState(null, '', location.pathname); showJoin(inviteCode.trim().slice(0, 5)); } else showMenu();
void checkForUpdate();
