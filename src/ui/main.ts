import './style.css';
import { aiPlan } from '../ai/ai';
import { createInitialState, sameSquare } from '../core/board';
import { gameOutcome, isInCheck, keepsKingSafe } from '../core/check';
import { checkMove, geometryReachable } from '../core/moves';
import { replaySteps } from '../core/replay';
import { resolveSubTurn } from '../core/resolution';
import { Game } from '../core/sequence';
import { DEFAULT_RULES, type CancelReason, type Color, type GameEvent, type GameState, type PieceState, type PieceType, type PlannedAction, type Square } from '../core/types';
import { dropPeer, host, join, type Conn } from '../net/peer';
import type { GuestToHost, HostToGuest } from '../net/transport';
import { burst, isMuted, puff, ring, setMuted, sfx, shout, unlockAudio } from './fx';
import { pieceSvg } from './pieces';
import { VERSION_LABEL, checkForUpdate, hardReload } from './version';

const SIZE = DEFAULT_RULES.size;
const SUBS = DEFAULT_RULES.subTurns;
const CELL = 100 / SIZE; // largeur d'une case, en % du plateau
const PLAN_SECONDS = 20;
const STEP_MS = 1100; // durée d'un sous-tour à l'écran
const SUB_COLORS = ['#7ad7ff', '#ffd85e', '#ff8fd0', '#8dff9a', '#ffa05e'];
const DRAG_THRESHOLD = 6; // px avant qu'un appui devienne un glisser
const FILES = 'abcde';
const NAMES: Record<PieceType, string> = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier', P: 'Pion' };
const REASONS: Record<CancelReason, string> = {
  'piece-not-found': 'la pièce a été détruite', 'not-owner': 'pièce adverse', 'already-acted': 'déjà jouée',
  'no-move': 'pas de déplacement', 'out-of-bounds': 'hors plateau', 'illegal-geometry': 'impossible depuis sa position réelle',
  'path-blocked': 'trajectoire bloquée', 'friendly-occupied': 'case alliée', 'blocked-forward': 'pion bloqué', 'no-capture-target': 'rien à capturer',
  'target-moved': 'la cible est partie', 'ally-conflict': 'un allié visait la même case',
  'king-in-check': "le roi doit d'abord sortir d'échec", 'king-capture': 'on ne capture pas un roi : on le met mat',
};

const app = document.getElementById('app')!;
type Mode = 'ai' | 'host' | 'guest';

// --- État de l'application ---------------------------------------------------
let mode: Mode = 'ai';
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
let currentStep = -1; // sous-tour affiché pendant la résolution
let timer: number | undefined;
let logLines: { text: string; cls?: string }[] = [];
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

// --- Menus -------------------------------------------------------------------
function showMenu(msg = '') {
  clearInterval(timer); dropPeer(); conn = null; game = null; busy = false;
  app.innerHTML = `<section class="menu-card">
    <div class="logo"><span class="piece-logo mini w">${pieceSvg('K')}</span><h1>Chrono Chess</h1></div>
    <p class="tagline">Programmez <b>${SUBS} coups</b> en secret. Ils se jouent <b>tous en même temps</b>.</p>
    ${rulesLegend()}
    <p class="hint">Si deux pièces arrivent sur la même case, la plus forte reste.</p>
    ${msg ? `<p class="error">${msg}</p>` : ''}
    <button class="primary" id="ai">Jouer contre l'IA</button>
    <button id="host">Créer une partie en ligne</button>
    <div class="row"><input id="code" placeholder="CODE" maxlength="5" autocomplete="off" /><button id="join">Rejoindre</button></div>
    <p class="version">${VERSION_LABEL} · <button class="link" id="refresh" title="Vide le cache et recharge la page">↻ Actualiser</button></p>
  </section>`;
  $('ai').onclick = () => { mode = 'ai'; me = 'white'; game = new Game(createInitialState()); state = game.state; buildGame(); startPlanning(); };
  $('host').onclick = showHost;
  $('refresh').onclick = () => void hardReload();
  $('join').onclick = () => showJoin(($('code') as HTMLInputElement).value.trim());
}

function showHost() {
  app.innerHTML = `<section class="menu-card"><h1 class="small">Partie en ligne</h1><p>Donnez ce code à votre adversaire <span class="hint">(cliquer pour copier)</span></p>
    <div class="code" id="c">· · · · ·</div><p id="st" class="hint">Création…</p><button id="back">Annuler</button></section>`;
  $('back').onclick = () => showMenu();
  host(
    (code) => {
      $('c').textContent = code; $('st').textContent = "En attente de l'adversaire…";
      $('c').onclick = () => navigator.clipboard?.writeText(code).then(() => ($('st').textContent = 'Code copié !'));
    },
    (c) => {
      mode = 'host'; me = 'white'; conn = c; game = new Game(createInitialState()); state = game.state;
      c.onmsg = (m: GuestToHost) => {
        if (m.t !== 'plan' || !game || m.seq !== game.state.sequence) return; // plan périmé
        game.submitPlan('black', m.plan);
        if (submitted) hostResolve();
      };
      c.onclose = () => showMenu("Connexion perdue avec l'adversaire.");
      c.send({ t: 'start', color: 'black', state } satisfies HostToGuest);
      buildGame(); startPlanning();
    },
    (e) => showMenu(e),
  );
}

function showJoin(code: string) {
  if (code.length < 5) return showMenu('Entrez un code à 5 caractères.');
  app.innerHTML = `<section class="menu-card"><h1 class="small">Connexion…</h1><div class="code">${code.toUpperCase()}</div></section>`;
  join(code, (c) => {
    mode = 'guest'; me = 'black'; conn = c;
    c.onmsg = (m: HostToGuest) => {
      if (m.t === 'start') { state = m.state; buildGame(); startPlanning(); }
      if (m.t === 'resolved') playResolution(m.events, m.state);
    };
    c.onclose = () => showMenu("Connexion perdue avec l'hôte.");
  }, (e) => showMenu(e));
}

// --- Construction de l'écran de jeu ------------------------------------------
function buildGame() {
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
      <div class="right"><span class="clock" id="clock"></span><button class="icon" id="mute" title="Son"></button></div>
    </header>
    <div class="timebar"><i id="timebar"></i></div>
    <div class="boardwrap">
      <div class="board" id="board">${squares.join('')}
        <div class="layer" id="pieces"></div>
        <div class="layer" id="fx" style="z-index:6"></div>
        <div class="banner" id="banner" hidden></div>
      </div>
    </div>
    <div class="pips" id="pips">${SUB_COLORS.map((c, t) => `<span style="--c:${c}">${t + 1}</span>`).join('')}</div>
    <div class="slots" id="slots"></div>
    ${rulesLegend('dark')}
    <p class="hint center">Glissez une pièce (ou cliquez-la, puis sa destination). Cliquez un coup en bas pour le refaire avec les suivants.</p>
    <div class="row actions"><button id="clear">Annuler le dernier coup</button><button class="primary" id="ok">Valider</button></div>
    <div class="log" id="log"></div>`;
  boardEl = $('board'); piecesEl = $('pieces'); fxEl = $('fx');

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('pointercancel', () => endDrag(false, null));
  $('clear').onclick = () => { if (state.winner) { $('banner').hidden = false; return; } if (!locked()) { const last = plan.map((a) => a.length > 0).lastIndexOf(true); if (last >= 0) redoFrom(last); } };
  $('ok').onclick = () => (state.winner ? showMenu() : submit());
  const mute = $('mute');
  const paintMute = () => (mute.textContent = isMuted() ? '🔇' : '🔊');
  mute.onclick = () => { setMuted(!isMuted()); paintMute(); };
  paintMute();
}

const locked = () => busy || submitted || !!state.winner;

// --- Prévisualisation : le vrai moteur, l'adversaire restant immobile --------
/**
 * Dois-je d'abord sortir d'échec avant le coup `at` ? Seulement si mon roi l'était au début de la manche
 * et ne l'a pas quitté depuis : ensuite, on bouge librement.
 */
function mustEscape(states: GameState[], at: number): boolean {
  for (let i = 0; i <= at; i++) if (!isInCheck(states[i]!.pieces, SIZE, me)) return false;
  return true;
}

/** states[n] = position après mes n premiers coups (un coup caduc ne change rien). */
function previewStates(): GameState[] {
  const out: GameState[] = [planBase];
  for (let t = 0; t < SUBS; t++) {
    const a = plan[t]![0];
    const escape = new Set<Color>(mustEscape(out, t) ? [me] : []);
    out.push(a ? resolveSubTurn(out[t]!, t, [{ ...a, subTurn: t, owner: me, order: 0 }], () => 0, escape).state : out[t]!);
  }
  return out;
}

/** Message d'état pendant la planification. */
function planStatus(view: GameState, escape: boolean): string {
  if (escape) return "Échec ! Parez-le d'abord";
  if (isInCheck(view.pieces, SIZE, me)) return 'Attention : roi en échec à ce stade';
  if (viewAt === SUBS) {
    const out = gameOutcome(view.pieces, SIZE);
    if (out?.reason === 'checkmate' && out.winner === me) return "Mat prévu (si l'adversaire ne bouge pas)";
  }
  if (isInCheck(view.pieces, SIZE, opp(me))) return 'Échec prévu au roi adverse';
  return `Planifiez vos ${SUBS} coups`;
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

  $('status').textContent = over ? (over === 'draw' ? 'Match nul' : over === me ? 'Victoire !' : 'Défaite')
    : busy ? 'Résolution' : submitted ? 'Plan envoyé… en attente' : planStatus(view, mustEscape(states, viewAt));

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
      if (!isLegalTarget(view, p, to, esc)) continue;
      const c = checkMove(snap, p, to, dirOf(me));
      const cls = !c.ok ? 'hint-soft' : c.capture ? 'hint-cap' : 'hint';
      sqEl(to)?.classList.add(cls);
    }
  }

  // Cartes des coups
  $('slots').innerHTML = SUB_COLORS.map((color, t) => {
    const a = plan[t]![0]; const piece = a && planBase.pieces.find((q) => q.id === a.pieceId);
    const from = a && states[t]!.pieces.find((q) => q.id === a.pieceId)?.pos;
    const body = a && piece
      ? `<span class="mini ${piece.color[0]}">${pieceSvg(piece.type)}</span>${from
        ? `<span>${sqName(from.file, from.rank)}→${sqName(a.to.file, a.to.rank)}</span>`
        : '<span class="gone">détruite</span>'}`
      : '<span class="empty">Aucun coup</span>';
    return `<button class="slot ${t === activeSub && !busy ? 'active' : ''} ${currentStep === t ? 'now' : ''}" data-t="${t}" style="--c:${color}"><em>${t + 1}</em>${body}</button>`;
  }).join('');
  $('slots').querySelectorAll<HTMLElement>('.slot').forEach((el) => (el.onclick = () => {
    if (!locked()) redoFrom(+el.dataset.t!);
  }));
  $('pips').querySelectorAll('span').forEach((el, i) => el.classList.toggle('on', i === currentStep));
  // Partie finie : les boutons du bas permettent de revoir le résultat ou de quitter, plateau visible.
  $('clear').textContent = over ? 'Voir le résultat' : 'Annuler le dernier coup';
  $('ok').textContent = over ? 'Retour au menu' : 'Valider';
  ($('ok') as HTMLButtonElement).disabled = over ? busy : locked();
  ($('clear') as HTMLButtonElement).disabled = over ? busy : locked();
  $('log').innerHTML = logLines.map((l) => `<div class="${l.cls ?? ''}">${l.text}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;
}

/**
 * Destination autorisée par l'interface : géométrie valide, pas sur une de mes pièces, et sans
 * mettre/laisser mon roi en échec (l'adversaire étant supposé immobile, comme le moteur).
 */
function isLegalTarget(view: GameState, p: PieceState, to: Square, escape: boolean): boolean {
  if (!geometryReachable(p, to, SIZE, dirOf(me))) return false;
  if (view.pieces.some((q) => q.color === me && sameSquare(q.pos, to))) return false;
  if (view.pieces.some((q) => q.type === 'K' && q.color !== me && sameSquare(q.pos, to))) return false; // un roi ne se capture pas
  return !escape || keepsKingSafe(view.pieces, SIZE, p, to);
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
  plan[activeSub] = [{ pieceId: id, to }].slice(0, DEFAULT_RULES.maxActionsPerSubTurn);
  sfx.plan();
  selected = null;
  viewAt = activeSub + 1;
  activeSub = Math.min(activeSub + 1, SUBS - 1);
  // Tous les coups sont programmés : validation automatique (inutile d'attendre la fin du chrono).
  if (plan.every((a) => a.length > 0)) { submit(); return; }
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
  if (p && isLegalTarget(view, p, sq, esc)) place(p.id, sq);
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
  if (sq && isLegalTarget(view, p, sq, mustEscape(states, viewAt))) {
    place(d.id, sq);
  } else {
    refreshPlanUi(); // retour à la case d'origine
  }
}

// --- Cycle de jeu --------------------------------------------------------------
function startPlanning() {
  plan = emptyPlan(); activeSub = 0; viewAt = 0; selected = null; drag = null;
  submitted = false; busy = false; currentStep = -1;
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
    game!.submitPlan(opp(me), aiPlan(state, opp(me)));
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
function describe(e: GameEvent, before: GameState): { text: string; cls?: string } | null {
  const nm = (id: string) => { const p = before.pieces.find((q) => q.id === id); return p ? `${NAMES[p.type]} ${p.color === 'white' ? 'blanc' : 'noir'}` : id; };
  const n = (e as { subTurn: number }).subTurn + 1;
  switch (e.kind) {
    case 'move': return { text: `<b>${n}</b> ${nm(e.pieceId)} ${sqName(e.from.file, e.from.rank)}→${sqName(e.to.file, e.to.rank)}` };
    case 'cancelled': return { text: `<b>${n}</b> ✗ ${nm(e.pieceId)} → ${sqName(e.to.file, e.to.rank)} : ${REASONS[e.reason]}`, cls: 'cancel' };
    case 'capture': return { text: `<b>${n}</b> ${nm(e.attackerId)} écrase ${nm(e.victimId)}`, cls: 'cap' };
    case 'collision': return { text: `<b>${n}</b> Choc en ${sqName(e.at.file, e.at.rank)} : ${e.winnerId ? nm(e.winnerId) + " l'emporte" : 'destruction mutuelle'}`, cls: 'cap' };
    case 'promotion': return { text: `<b>${n}</b> ${nm(e.pieceId)} promu en ${NAMES[e.to].toLowerCase()}` };
    case 'check': return { text: `<b>${n}</b> Échec au roi ${e.color === 'white' ? 'blanc' : 'noir'} !`, cls: 'cap' };
    case 'game-over': return { text: endText(e.winner, e.reason), cls: 'cap' };
    default: return null;
  }
}

function endText(winner: Color | 'draw', reason?: string): string {
  if (reason === 'stalemate') return 'Pat : match nul.';
  if (reason === 'insufficient') return 'Il ne reste que les deux rois : match nul.';
  if (winner === 'draw') return reason === 'checkmate' ? 'Double échec et mat : match nul.' : 'Match nul.';
  return `Échec et mat : victoire des ${winner === 'white' ? 'blancs' : 'noirs'} !`;
}

function playResolution(events: GameEvent[], finalState: GameState) {
  busy = true; clearInterval(timer); logLines = []; selected = null; drag = null; endReason = undefined;
  $('clock').textContent = ''; ($('timebar') as HTMLElement).style.width = '0%';
  snapPieces(state.pieces); // les pièces quittent la position "prévue" pour la position réelle
  const steps = replaySteps(state, events);
  let i = 0;
  const next = () => {
    const step = steps[i++];
    if (!step) { logLines.push({ text: `Fin des ${SUBS} coups : on vérifie mat et pat…` }); refreshPlanUi(); window.setTimeout(finish, 700); return; }
    currentStep = step.subTurn;
    const before = state;
    for (const e of step.events) { const d = describe(e, before); if (d) logLines.push(d); if (e.kind === 'game-over') endReason = e.reason; }

    // 1. Coups caducs : la pièce tremble, un nuage de fumée, rien ne bouge.
    for (const e of step.events) if (e.kind === 'cancelled') {
      const p = before.pieces.find((q) => q.id === e.pieceId);
      if (p) {
        const c = pct(p.pos); puff(fxEl, c.x, c.y); sfx.fizzle();
        const inner = pieceEls.get(p.id)?.querySelector('.inner');
        inner?.classList.add('wobble'); window.setTimeout(() => inner?.classList.remove('wobble'), 700);
      }
    }
    // 2. Déplacements : les pièces glissent (simultanément).
    state = step.state;
    for (const e of step.events) if (e.kind === 'move') {
      const inner = pieceEls.get(e.pieceId)?.querySelector('.inner');
      inner?.classList.add('lift'); window.setTimeout(() => inner?.classList.remove('lift'), 600);
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
    window.setTimeout(() => {
      for (const e of step.events) {
        if (e.kind === 'capture' || e.kind === 'collision') {
          const c = pct(e.at);
          const col = e.kind === 'collision' ? '#ffb04c' : '#ff5a6e';
          burst(fxEl, c.x, c.y, col);
          shout(fxEl, c.x, c.y, e.kind === 'collision' ? 'CRASH!' : 'POW!', col);
          if (e.kind === 'collision') { ring(fxEl, c.x, c.y, col); sfx.collision(); } else sfx.capture();
          boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
        }
        if (e.kind === 'promotion') { const c = pct(e.at); ring(fxEl, c.x, c.y, '#7dffb0'); shout(fxEl, c.x, c.y, NAMES[e.to].toUpperCase() + '!', '#7dffb0'); }
      }
      for (const p of dyingList) {
        const el = pieceEls.get(p.id);
        el?.querySelector('.inner')?.classList.add('die');
        window.setTimeout(() => { el?.remove(); pieceEls.delete(p.id); }, 520);
      }
    }, 520);
    window.setTimeout(next, STEP_MS);
  };
  const finish = () => {
    state = finalState; busy = false; currentStep = -1;
    syncPieces(state.pieces); refreshPlanUi();
    if (state.winner) {
      const ban = $('banner'); const won = state.winner === me;
      ban.innerHTML = `<h2>${state.winner === 'draw' ? 'Match nul' : won ? 'Victoire !' : 'Défaite'}</h2><p>${endText(state.winner, endReason)}</p><button class="primary" id="view">Voir l'échiquier</button><button id="menu">Retour au menu</button>`;
      ban.className = `banner ${state.winner === 'draw' ? '' : won ? 'win' : 'lose'}`; ban.hidden = false;
      $('menu').onclick = () => showMenu();
      $('view').onclick = () => { ban.hidden = true; };
      state.winner === me ? sfx.win() : sfx.lose();
    } else startPlanning();
  };
  refreshPlanUi();
  window.setTimeout(next, 400);
}

function $(id: string): HTMLElement { return document.getElementById(id)!; }

showMenu();
void checkForUpdate();
