import './style.css';
import { aiPlan, LEVELS, type Level } from '../ai/ai';
import { cloneState, createInitialState, rebuildGrid, sameSquare } from '../core/board';
import { gameOutcome, isInCheck, keepsKingSafe } from '../core/check';
import { checkMove, geometryReachable } from '../core/moves';
import { replaySteps } from '../core/replay';
import { resolveSubTurn } from '../core/resolution';
import { Game } from '../core/sequence';
import { DEFAULT_RULES, PROMOTIONS, type CancelReason, type Color, type GameEvent, type GameState, type PieceState, type PieceType, type PlannedAction, type Square } from '../core/types';
import { dropPeer, host, join, type Conn } from '../net/peer';
import type { GuestToHost, HostToGuest } from '../net/transport';
import { burst, isMuted, puff, ring, setMuted, sfx, shout, unlockAudio } from './fx';
import { flagSvg, getLang, nextLang, setLang, t, type Key } from './i18n';
import { pieceSvg } from './pieces';
import { VERSION_SHORT, checkForUpdate } from './version';

const SIZE = DEFAULT_RULES.size;
const SUBS = DEFAULT_RULES.subTurns;
const CELL = 100 / SIZE; // largeur d'une case, en % du plateau
const PLAN_SECONDS = 10;
const STEP_MS = 1100; // durée d'un sous-tour à l'écran
const SUB_COLORS = ['#7ad7ff', '#ffd85e', '#ff8fd0', '#8dff9a', '#ffa05e'];
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
let game: Game | null = null; // autoritaire : IA et hôte seulement
let conn: Conn | null = null;
const emptyPlan = (): PlannedAction[][] => Array.from({ length: SUBS }, () => []);
let plan: PlannedAction[][] = emptyPlan();
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
let currentStep = -1; // sous-tour affiché pendant la résolution
let timer: number | undefined;
let logLines: LogLine[] = [];
let planBase: GameState = state; // position au début de la Séquence
let endReason: string | undefined; // raison de fin de partie (mat, pat) pour la bannière
let drag: { id: string; x: number; y: number; active: boolean; pointerId: number } | null = null;

const opp = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const sqName = (f: number, r: number) => FILES[f]! + (r + 1);
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

/** Affiche le pied de page ; `redraw` redessine l'écran courant quand on change de langue. `null` = masqué. */
function showFoot(redraw: (() => void) | null) {
  foot.hidden = !redraw;
  if (!redraw) return;
  foot.innerHTML = `<span class="version">${VERSION_SHORT}</span><button class="flag" id="lang" title="Language">${flagSvg(getLang())}</button>`;
  $('lang').onclick = () => { setLang(nextLang()); redraw(); };
}

// --- Menus -------------------------------------------------------------------
function showMenu(msg = '') {
  runId++; finishing = false; closeGameMenu();
  clearInterval(timer); dropPeer(); conn = null; game = null; busy = false;
  app.innerHTML = `<section class="menu-card">
    <div class="logo"><span class="piece-logo mini w">${pieceSvg('K')}</span><h1>Chrono Chess</h1></div>
    <p class="tagline">${t('tagline', { n: SUBS })}</p>
    ${rulesLegend()}
    <p class="hint">${t('rule')}</p>
    ${msg ? `<p class="error">${msg}</p>` : ''}
    <button class="primary" id="ai">${t('play_ai')}</button>
    <button id="host">${t('host_btn')}</button>
    <div class="row"><input id="code" placeholder="${t('code_ph')}" maxlength="5" autocomplete="off" /><button id="join">${t('join_btn')}</button></div>
  </section>`;
  showFoot(() => showMenu());
  $('ai').onclick = showLevels;
  $('host').onclick = showHost;
  $('join').onclick = () => showJoin(($('code') as HTMLInputElement).value.trim());
}

/** Nouvelle partie contre l'IA, au niveau déjà choisi. */
function newAiGame() {
  runId++; finishing = false;
  mode = 'ai'; me = 'white'; game = new Game(createInitialState()); state = game.state;
  buildGame(); startPlanning();
}

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
    <div class="code" id="c">· · · · ·</div><p id="st" class="hint">${t('creating')}</p><button id="back">${t('cancel')}</button></section>`;
  $('back').onclick = () => showMenu();
  host(
    (code) => {
      $('c').textContent = code; $('st').textContent = t('waiting_opp');
      $('c').onclick = () => navigator.clipboard?.writeText(code).then(() => ($('st').textContent = t('copied')));
    },
    (c) => {
      mode = 'host'; me = 'white'; conn = c; game = new Game(createInitialState()); state = game.state;
      c.onmsg = (m: GuestToHost) => {
        if (m.t !== 'plan' || !game || m.seq !== game.state.sequence) return; // plan périmé
        game.submitPlan('black', m.plan);
        if (submitted) hostResolve();
      };
      c.onclose = () => showMenu(t('lost_opp'));
      c.send({ t: 'start', color: 'black', state } satisfies HostToGuest);
      buildGame(); startPlanning();
    },
    (e) => showMenu(errText(e)),
  );
}

function showJoin(code: string) {
  if (code.length < 5) return showMenu(t('enter_code'));
  showFoot(null);
  app.innerHTML = `<section class="menu-card"><h1 class="small">${t('connecting')}</h1><div class="code">${code.toUpperCase()}</div></section>`;
  join(code, (c) => {
    mode = 'guest'; me = 'black'; conn = c;
    c.onmsg = (m: HostToGuest) => {
      if (m.t === 'start') { state = m.state; buildGame(); startPlanning(); }
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
      <div class="right"><span class="clock" id="clock"></span><button class="icon" id="menu-btn" title="${t('menu')}" aria-label="${t('menu')}">${MENU_ICON}</button></div>
      <div class="gamemenu" id="gmenu" hidden>
        <div class="gm-title">${t('history')}</div>
        <div class="log" id="log"></div>
        ${mode === 'ai' ? `<button id="gm-new">${t('menu_new')}</button>` : ''}
        <button id="gm-sound"></button>
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
    <div class="slots" id="slots"></div>
    <div class="row actions"><button class="primary" id="ok">${t('finish')}</button></div>`;
  boardEl = $('board'); piecesEl = $('pieces'); fxEl = $('fx');

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('pointercancel', () => endDrag(false, null));
  // Partie terminée, le bouton rouvre la bannière de résultat ; sinon il envoie le plan sans attendre la fin du chrono.
  $('ok').onclick = () => { if (state.winner) $('banner').hidden = false; else submit(); };
  const soundBtn = $('gm-sound');
  const paintSound = () => (soundBtn.textContent = t(isMuted() ? 'sound_on' : 'sound_off'));
  paintSound();
  $('menu-btn').onclick = () => { paintSound(); $('gmenu').hidden = !$('gmenu').hidden; $('log').scrollTop = $('log').scrollHeight; };
  soundBtn.onclick = () => { setMuted(!isMuted()); paintSound(); closeGameMenu(); };
  $('gm-quit').onclick = () => showMenu();
  if (mode === 'ai') $('gm-new').onclick = () => newAiGame();
}

/** Menu de partie : se ferme quand on touche ailleurs. */
const closeGameMenu = () => { const m = document.getElementById('gmenu'); if (m) m.hidden = true; };
window.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('#gmenu, #menu-btn')) closeGameMenu();
});

const MENU_ICON = `<svg viewBox="0 0 12 10" shape-rendering="crispEdges" aria-hidden="true"><rect width="12" height="2"/><rect y="4" width="12" height="2"/><rect y="8" width="12" height="2"/></svg>`;

const locked = () => busy || submitted || finishing || !!state.winner;

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
  if (!p || next.pieces.some((q) => q.color === p.color && sameSquare(q.pos, a.to))) return s; // case alliée : jamais
  const target = next.pieces.find((q) => q.color !== p.color && sameSquare(q.pos, a.to));
  if (target?.type === 'K') return s; // un roi ne se capture pas
  next.pieces = next.pieces.filter((q) => q !== target);
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
  return t('status_plan', { n: SUBS });
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
    : busy ? t('resolving') : submitted ? t('plan_sent') : planStatus(view, mustEscape(states, viewAt));

  // Une pièce adverse qui serait mangée si tout se passe bien reste affichée en transparence.
  const alive = new Set(view.pieces.map((q) => q.id));
  const ghosts = preview ? planBase.pieces.filter((q) => !alive.has(q.id)) : [];
  if (preview && !drag?.active) syncPieces([...view.pieces, ...ghosts], new Set(ghosts.map((q) => q.id)));

  // Cases : sélection + aides
  boardEl.querySelectorAll('.sq').forEach((el) => el.classList.remove('sel', 'hint', 'hint-cap', 'hint-soft'));
  piecesEl.querySelectorAll('.piece').forEach((el) => el.classList.remove('selected'));
  const esc = mustEscape(states, viewAt);
  const p = selected && preview && !locked() ? view.pieces.find((q) => q.id === selected) : undefined;
  if (p) {
    sqEl(p.pos)?.classList.add('sel');
    pieceEls.get(p.id)?.classList.add('selected');
    const snap = { size: SIZE, at: (s: Square) => view.pieces.find((q) => sameSquare(q.pos, s)) };
    for (let f = 0; f < SIZE; f++) for (let r = 0; r < SIZE; r++) {
      const to = { file: f, rank: r };
      if (!isLegalTarget(view, p, to, viewAt === 0, esc)) continue;
      const c = checkMove(snap, p, to, dirOf(me));
      const cls = !c.ok ? 'hint-soft' : c.capture ? 'hint-cap' : 'hint';
      sqEl(to)?.classList.add(cls);
    }
  }

  // Cartes des coups
  $('slots').innerHTML = SUB_COLORS.map((color, i) => {
    const a = plan[i]![0]; const piece = a && planBase.pieces.find((q) => q.id === a.pieceId);
    const from = a && states[i]!.pieces.find((q) => q.id === a.pieceId)?.pos;
    const body = a && piece
      ? `<span class="mini ${piece.color[0]}">${pieceSvg(piece.type)}</span>${from
        ? `<span>${sqName(from.file, from.rank)}→${sqName(a.to.file, a.to.rank)}</span>`
        : `<span class="gone">${t('slot_gone')}</span>`}`
      : `<span class="empty">${t('slot_empty')}</span>`;
    return `<button class="slot ${i === activeSub && !busy ? 'active' : ''} ${currentStep === i ? 'now' : ''}" data-t="${i}" style="--c:${color}"><em>${i + 1}</em>${body}</button>`;
  }).join('');
  $('slots').querySelectorAll<HTMLElement>('.slot').forEach((el) => (el.onclick = () => {
    if (!locked()) redoFrom(+el.dataset.t!);
  }));
  // Partie finie : le bouton du bas permet de revoir le résultat, plateau visible.
  $('ok').textContent = over ? t('see_result') : t('finish');
  ($('ok') as HTMLButtonElement).disabled = over ? busy : locked();
  $('log').innerHTML = logHtml();
  $('log').scrollTop = $('log').scrollHeight;
}

/**
 * Destination proposée par l'interface.
 * - 1er coup : la position est connue, on n'accepte que ce que le moteur validerait (trajectoire libre, pion qui capture
 *   une vraie cible, roi jamais sur une case attaquée, sortie d'échec si le roi l'est au départ).
 * - À partir du 2e coup : l'adversaire aura bougé, donc tout ce qui est géométriquement possible est proposé
 *   (sauf une case occupée par l'une de mes pièces) ; si le coup est vraiment illégal, il sera annulé à la résolution.
 */
function isLegalTarget(view: GameState, p: PieceState, to: Square, first: boolean, escape: boolean): boolean {
  if (!geometryReachable(p, to, SIZE, dirOf(me))) return false;
  if (view.pieces.some((q) => q.color === me && sameSquare(q.pos, to))) return false;
  if (!first) return true;
  const snap = { size: SIZE, at: (s: Square) => view.pieces.find((q) => sameSquare(q.pos, s)) };
  if (!checkMove(snap, p, to, dirOf(me)).ok) return false;
  if (snap.at(to)?.type === 'K') return false; // un roi ne se capture pas
  return !(escape || p.type === 'K') || keepsKingSafe(view.pieces, SIZE, p, to); // le roi évite toujours les cases attaquées
}

const sqEl = (s: Square) => document.querySelector<HTMLElement>(`.sq[data-f="${s.file}"][data-r="${s.rank}"]`);

/** Supprime le coup `t` et tous les suivants, pour les refaire (jamais au-delà du premier trou). */
function redoFrom(t: number) {
  const firstEmpty = plan.findIndex((a) => a.length === 0);
  const from = Math.min(t, firstEmpty < 0 ? SUBS : firstEmpty);
  for (let i = from; i < SUBS; i++) plan[i] = [];
  activeSub = Math.min(from, SUBS - 1); viewAt = activeSub; selected = null;
  refreshPlanUi();
}

/** Enregistre le coup du sous-tour actif : la pièce se déplace à l'écran. */
function place(id: string, to: Square) {
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
  if (mine) {
    selected = mine.id; sfx.select();
    drag = { id: mine.id, x: ev.clientX, y: ev.clientY, active: false, pointerId: ev.pointerId };
    refreshPlanUi();
    return;
  }
  // clic-clic : destination d'une pièce déjà sélectionnée
  const p = selected ? view.pieces.find((q) => q.id === selected) : undefined;
  if (p && isLegalTarget(view, p, sq, viewAt === 0, esc)) place(p.id, sq);
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
  if (!d.active) return; // simple clic : la pièce reste sélectionnée
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
function startPlanning() {
  plan = emptyPlan(); activeSub = 0; viewAt = 0; selected = null; drag = null;
  submitted = false; busy = false; finishing = false; currentStep = -1;
  planBase = state;
  deadline = Date.now() + PLAN_SECONDS * 1000;
  $('banner').hidden = true;
  clearInterval(timer);
  let lastTick = -1;
  timer = window.setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    $('clock').textContent = (left / 1000).toFixed(1);
    const bar = $('timebar') as HTMLElement;
    bar.style.width = (left / (PLAN_SECONDS * 1000)) * 100 + '%';
    bar.classList.toggle('low', left < 5000);
    const s = Math.ceil(left / 1000);
    if (left < 5000 && s !== lastTick && left > 0) { lastTick = s; sfx.tick(); }
    if (left <= 0) submit();
  }, 100);
  snapPieces(state.pieces);
  refreshPlanUi();
}

function submit() {
  if (submitted || busy || state.winner) return;
  submitted = true; clearInterval(timer); selected = null; viewAt = SUBS;
  if (drag?.active) endDrag(false, null);
  $('clock').textContent = '';
  if (mode === 'ai') {
    game!.submitPlan(me, plan);
    game!.submitPlan(opp(me), aiPlan(state, opp(me), DEFAULT_RULES, Math.random, aiLevel));
    hostResolve();
  } else if (mode === 'host') {
    game!.submitPlan('white', plan);
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
/** Figurines (notation algébrique à la Lichess) : le pion n'en a pas. Pleines pour les noirs, creuses pour les blancs. */
const FIGURINE: Record<Color, Record<PieceType, string>> = {
  white: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '' },
  black: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '' },
};
const dot = (c: Color) => (c === 'white' ? '○' : '●');

/** Coup en notation algébrique : Cc3, Txd5, exd5, e8=T… (colonne ou rangée d'origine si deux pièces identiques peuvent y aller). */
function notate(p: PieceState, to: Square, before: GameState, capture: boolean, promo?: PieceType): string {
  let origin = '';
  if (p.type === 'P') {
    if (capture) origin = FILES[p.pos.file]!;
  } else {
    const rivals = before.pieces.filter((q) => q.id !== p.id && q.color === p.color && q.type === p.type && geometryReachable(q, to, SIZE, dirOf(p.color)));
    if (rivals.length) origin = rivals.some((q) => q.pos.file === p.pos.file) ? String(p.pos.rank + 1) : FILES[p.pos.file]!;
  }
  const fig = (t: PieceType) => (FIGURINE[p.color][t] ? `<span class="fig">${FIGURINE[p.color][t]}</span>` : '');
  return `${fig(p.type)}${origin}${capture ? 'x' : ''}${sqName(to.file, to.rank)}${promo ? '=' + fig(promo) : ''}`;
}

/** Ligne de journal : `n` = numéro du coup, `side` = colonne (blancs / noirs) ; sans `side`, ligne pleine largeur. */
interface LogLine { text: string; cls?: string; n?: number; side?: Color }

function describe(e: GameEvent, before: GameState, stepEvents: GameEvent[]): LogLine | null {
  const piece = (id: string) => before.pieces.find((q) => q.id === id);
  const n = (e as { subTurn: number }).subTurn + 1;
  switch (e.kind) {
    case 'move': {
      const p = piece(e.pieceId);
      if (!p) return null;
      const capture = stepEvents.some((x) => (x.kind === 'capture' && x.attackerId === p.id) || (x.kind === 'collision' && x.winnerId === p.id));
      const promo = stepEvents.find((x) => x.kind === 'promotion' && x.pieceId === p.id);
      return { n, side: p.color, text: notate(p, e.to, before, capture, promo?.kind === 'promotion' ? promo.to : undefined), cls: capture ? 'cap' : undefined };
    }
    case 'cancelled': {
      const p = piece(e.pieceId);
      // Coup impossible : juste le ✗ (la raison n'apparaît qu'au survol).
      return { n, side: e.owner, text: `<span title="${reasonText(e.reason)}">✗ ${p ? notate(p, e.to, before, false) : sqName(e.to.file, e.to.rank)}</span>`, cls: 'cancel' };
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
  if (winner === 'draw') return reason === 'checkmate' ? t('end_double') : t('end_draw');
  return t(winner === 'white' ? 'end_mate_white' : 'end_mate_black');
}

function playResolution(events: GameEvent[], finalState: GameState) {
  const run = ++runId;
  const later = (fn: () => void, ms: number) => window.setTimeout(() => { if (run === runId) fn(); }, ms);
  busy = true; clearInterval(timer); logLines = []; selected = null; drag = null; endReason = undefined;
  $('clock').textContent = ''; ($('timebar') as HTMLElement).style.width = '0%';
  snapPieces(state.pieces); // les pièces quittent la position "prévue" pour la position réelle
  const steps = replaySteps(state, events);
  let i = 0;
  const next = () => {
    const step = steps[i++];
    if (!step) { later(finish, 700); return; }
    currentStep = step.subTurn;
    const before = state;
    for (const e of step.events) { const d = describe(e, before, step.events); if (d) logLines.push(d); if (e.kind === 'game-over') endReason = e.reason; }

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
    }, 520);
    later(next, STEP_MS);
  };
  const finish = () => {
    state = finalState; busy = false; currentStep = -1;
    syncPieces(state.pieces); refreshPlanUi();
    if (state.winner) {
      const ban = $('banner'); const won = state.winner === me;
      ban.innerHTML = `<h2>${state.winner === 'draw' ? t('draw') : won ? t('win') : t('lose')}</h2><p>${endText(state.winner, endReason)}</p><button class="primary" id="view">${t('view_board')}</button><button id="menu">${t('to_menu')}</button>`;
      ban.className = `banner ${state.winner === 'draw' ? '' : won ? 'win' : 'lose'}`; ban.hidden = false;
      $('menu').onclick = () => showMenu();
      $('view').onclick = () => { ban.hidden = true; };
      state.winner === me ? sfx.win() : sfx.lose();
    } else startPlanning();
  };
  refreshPlanUi();
  later(next, 400);
}

function $(id: string): HTMLElement { return document.getElementById(id)!; }

showMenu();
void checkForUpdate();
