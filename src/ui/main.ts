import './style.css';
import { randomPlan } from '../ai/randomAi';
import { createInitialState } from '../core/board';
import { gameOutcome, isInCheck, keepsKingSafe } from '../core/check';
import { checkMove, geometryReachable } from '../core/moves';
import { replaySteps } from '../core/replay';
import { Game } from '../core/sequence';
import { DEFAULT_RULES, type CancelReason, type Color, type GameEvent, type GameState, type PieceState, type PieceType, type PlannedAction, type Square } from '../core/types';
import { dropPeer, host, join, type Conn } from '../net/peer';
import type { GuestToHost, HostToGuest } from '../net/transport';
import { burst, isMuted, puff, ring, setMuted, sfx, unlockAudio } from './fx';
import { PIECE_DEFS, pieceSvg } from './pieces';

const PLAN_SECONDS = 10;
const STEP_MS = 1500; // durée d'un sous-tour à l'écran
const SUB_COLORS = ['#4cc2ff', '#ffc247', '#ff6bd6'];
const DRAG_THRESHOLD = 6; // px avant qu'un appui devienne un glisser
const NAMES: Record<PieceType, string> = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier', P: 'Pion' };
const REASONS: Record<CancelReason, string> = {
  'piece-not-found': 'la pièce a été capturée', 'not-owner': 'pièce adverse', 'already-acted': 'déjà jouée',
  'no-move': 'pas de déplacement', 'out-of-bounds': 'hors plateau', 'illegal-geometry': 'impossible depuis sa position réelle',
  'path-blocked': 'trajectoire bloquée', 'friendly-occupied': 'case alliée', 'blocked-forward': 'pion bloqué',
  'no-capture-target': 'rien à capturer', 'target-moved': 'la cible est partie', 'ally-conflict': 'un allié visait la même case',
  'king-in-check': 'mettrait ou laisserait son roi en échec', 'king-capture': 'on ne capture pas un roi : on le met mat',
};

const app = document.getElementById('app')!;
type Mode = 'ai' | 'host' | 'guest';

// --- État de l'application ---------------------------------------------------
let mode: Mode = 'ai';
let me: Color = 'white';
let state: GameState = createInitialState();
let game: Game | null = null; // autoritaire : IA et hôte seulement
let conn: Conn | null = null;
let plan: PlannedAction[][] = [[], [], []];
/** Sous-tour en cours de programmation (0..2). */
let activeSub = 0;
/** Nombre de coups programmés appliqués à l'affichage (0..3) : le plateau montre la position prévue. */
let viewAt = 0;
let selected: string | null = null;
let deadline = 0;
let submitted = false;
let busy = false;
let currentStep = -1; // sous-tour affiché pendant la résolution
let timer: number | undefined;
let logLines: { text: string; cls?: string }[] = [];
let planBase: PieceState[] = []; // pièces au début de la Séquence
let endReason: string | undefined; // raison de fin de partie (mat, pat) pour la bannière
let drag: { id: string; x: number; y: number; active: boolean; pointerId: number } | null = null;

const opp = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const sqName = (f: number, r: number) => 'abcdefgh'[f]! + (r + 1);
const flip = () => me === 'black';
/** Case logique -> colonne/ligne à l'écran (le joueur noir voit le plateau retourné). */
const disp = (s: Square) => ({ c: flip() ? 7 - s.file : s.file, row: flip() ? s.rank : 7 - s.rank });
const pct = (s: Square) => { const d = disp(s); return { x: (d.c + 0.5) * 12.5, y: (d.row + 0.5) * 12.5 }; };
const startRankOf = (c: Color) => (c === 'white' ? 1 : 6);
const dirOf = (c: Color): 1 | -1 => (c === 'white' ? 1 : -1);

// --- Références DOM de l'écran de jeu ---------------------------------------
let boardEl: HTMLElement, piecesEl: HTMLElement, fxEl: HTMLElement;
const pieceEls = new Map<string, HTMLElement>();

document.body.insertAdjacentHTML('afterbegin', PIECE_DEFS);
window.addEventListener('pointerdown', unlockAudio);

// --- Menus -------------------------------------------------------------------
function showMenu(msg = '') {
  clearInterval(timer); dropPeer(); conn = null; game = null; busy = false;
  app.innerHTML = `<section class="card menu-card">
    <div class="logo"><span class="piece-logo">${pieceSvg('K').replace('class="pc"', 'class="pc w"')}</span><h1>Chrono<span>Chess</span></h1></div>
    <p class="tagline">Programmez 3 coups en secret. Ils se jouent <b>tous en même temps</b>. Un coup devenu impossible fait <i>pschitt</i>.</p>
    ${msg ? `<p class="error">${msg}</p>` : ''}
    <button class="primary" id="ai">Jouer contre l'IA</button>
    <button id="host">Créer une partie en ligne</button>
    <div class="row"><input id="code" placeholder="CODE" maxlength="5" autocomplete="off" /><button id="join">Rejoindre</button></div>
  </section>`;
  $('ai').onclick = () => { mode = 'ai'; me = 'white'; game = new Game(createInitialState()); state = game.state; buildGame(); startPlanning(); };
  $('host').onclick = showHost;
  $('join').onclick = () => showJoin(($('code') as HTMLInputElement).value.trim());
}

function showHost() {
  app.innerHTML = `<section class="card menu-card"><h1 class="small">Partie en ligne</h1><p>Donnez ce code à votre adversaire <span class="hint">(cliquer pour copier)</span></p>
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
  app.innerHTML = `<section class="card menu-card"><h1 class="small">Connexion…</h1><div class="code">${code.toUpperCase()}</div></section>`;
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
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const f = flip() ? 7 - col : col;
    const r = flip() ? row : 7 - row;
    const fileLabel = row === 7 ? `<i class="co f">${'abcdefgh'[f]}</i>` : '';
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
        <div class="layer" id="fx"></div>
        <div class="banner" id="banner" hidden></div>
      </div>
    </div>
    <div class="pips" id="pips">${[0, 1, 2].map((t) => `<span style="--c:${SUB_COLORS[t]}">${t + 1}</span>`).join('')}</div>
    <div class="slots" id="slots"></div>
    <p class="hint center">Glissez une pièce (ou cliquez-la, puis sa destination). Le plateau montre la position prévue : une pièce peut rejouer à chaque sous-tour.</p>
    <div class="row actions"><button id="clear">Effacer ce coup</button><button class="primary" id="ok">Valider</button></div>
    <div class="log" id="log"></div>`;
  boardEl = $('board'); piecesEl = $('pieces'); fxEl = $('fx');

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('pointercancel', () => endDrag(false, null));
  $('clear').onclick = () => { if (!locked()) { plan[activeSub] = []; viewAt = activeSub; selected = null; refreshPlanUi(); } };
  $('ok').onclick = submit;
  const mute = $('mute');
  const paintMute = () => (mute.textContent = isMuted() ? '🔇' : '🔊');
  mute.onclick = () => { setMuted(!isMuted()); paintMute(); };
  paintMute();
}

const locked = () => busy || submitted || !!state.winner;

// --- Prévisualisation : mes pièces sont déplacées selon mon plan ------------
/** Pièces telles qu'elles seraient après mes `upTo` premiers coups (en supposant qu'ils réussissent). */
function previewPieces(upTo: number): PieceState[] {
  const list: PieceState[] = planBase.map((p) => ({ ...p, pos: { ...p.pos } }));
  for (let t = 0; t < upTo; t++) {
    const a = plan[t]![0];
    const p = a && list.find((q) => q.id === a.pieceId);
    if (!p) continue;
    p.pos = { ...a.to }; p.hasMoved = true;
    if (p.type === 'P' && p.pos.rank === (p.color === 'white' ? 7 : 0)) p.type = 'Q';
  }
  return list;
}

/** Position effective de l'aperçu : une pièce adverse sous une de mes pièces prévues est considérée capturée. */
const effective = (list: PieceState[]) =>
  list.filter((p) => !(p.color !== me && list.some((q) => q.color === me && q.pos.file === p.pos.file && q.pos.rank === p.pos.rank)));

/** Message d'état pendant la planification (l'aperçu suppose l'adversaire immobile). */
function planStatus(): string {
  const eff = effective(previewPieces(viewAt));
  if (isInCheck(eff, 8, me)) return 'Échec ! Protégez votre roi';
  const out = gameOutcome(eff, 8);
  if (out?.reason === 'checkmate' && out.winner === me) return 'Mat prévu (si l\'adversaire ne bouge pas)';
  if (isInCheck(eff, 8, opp(me))) return 'Échec prévu au roi adverse';
  return 'Planifiez vos 3 coups';
}

/** Position d'une pièce juste avant le sous-tour t, d'après mon plan. */
const positionBefore = (id: string, t: number): Square => previewPieces(t).find((p) => p.id === id)!.pos;

// --- Pièces (éléments persistants : elles glissent d'une case à l'autre) -----
function syncPieces(list: PieceState[]) {
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
    // Une pièce adverse sous une de mes pièces prévues (capture supposée) est atténuée.
    const covered = p.color !== me && list.some((q) => q.color === me && q.pos.file === p.pos.file && q.pos.rank === p.pos.rank);
    el.classList.toggle('covered', covered);
    el.classList.toggle('check', p.type === 'K' && isInCheck(effective(list), 8, p.color));
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
  $('status').textContent = over ? (over === 'draw' ? 'Match nul' : over === me ? 'Victoire !' : 'Défaite')
    : busy ? 'Résolution' : submitted ? 'Plan envoyé… en attente' : planStatus();

  const preview = !busy && !over;
  const list = preview ? previewPieces(viewAt) : state.pieces;
  if (preview && !drag?.active) syncPieces(list);

  // Cases : sélection + aides
  boardEl.querySelectorAll('.sq').forEach((el) => el.classList.remove('sel', 'hint', 'hint-cap', 'hint-soft'));
  piecesEl.querySelectorAll('.piece').forEach((el) => el.classList.remove('selected'));
  if (selected && preview && !locked()) {
    const eff = effective(list);
    const p = list.find((q) => q.id === selected)!;
    sqEl(p.pos)?.classList.add('sel');
    pieceEls.get(selected)?.classList.add('selected');
    const snap = { size: 8, at: (s: Square) => eff.find((q) => q.pos.file === s.file && q.pos.rank === s.rank) };
    for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) {
      const to = { file: f, rank: r };
      if (!isLegalTarget(list, p, to)) continue;
      const c = checkMove(snap, p, to, startRankOf(me), dirOf(me));
      sqEl(to)?.classList.add(c.ok ? (c.capture ? 'hint-cap' : 'hint') : 'hint-soft');
    }
  }

  // Cartes des 3 sous-tours
  $('slots').innerHTML = [0, 1, 2].map((t) => {
    const a = plan[t]![0]; const p = a && planBase.find((q) => q.id === a.pieceId);
    const from = a && p ? positionBefore(a.pieceId, t) : null;
    const body = a && p && from
      ? `<span class="mini ${p.color[0]}">${pieceSvg(p.type)}</span><b>${NAMES[p.type]}</b><span>${sqName(from.file, from.rank)} → ${sqName(a.to.file, a.to.rank)}</span>`
      : '<span class="empty">Aucun coup</span>';
    return `<button class="slot ${t === activeSub && !busy ? 'active' : ''} ${currentStep === t ? 'now' : ''}" data-t="${t}" style="--c:${SUB_COLORS[t]}"><em>${t + 1}</em>${body}</button>`;
  }).join('');
  $('slots').querySelectorAll<HTMLElement>('.slot').forEach((el) => (el.onclick = () => {
    if (!locked()) { activeSub = +el.dataset.t!; viewAt = activeSub; selected = null; refreshPlanUi(); }
  }));
  $('pips').querySelectorAll('span').forEach((el, i) => el.classList.toggle('on', i === currentStep));
  ($('ok') as HTMLButtonElement).disabled = locked();
  ($('clear') as HTMLButtonElement).disabled = locked();
  $('log').innerHTML = logLines.map((l) => `<div class="${l.cls ?? ''}">${l.text}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;
}

/**
 * Destination autorisée par l'interface : géométrie valide, pas sur une de mes pièces, et sans
 * mettre/laisser mon roi en échec (l'adversaire étant supposé immobile, comme le moteur).
 */
function isLegalTarget(list: PieceState[], p: PieceState, to: Square): boolean {
  if (!geometryReachable(p, to, 8, startRankOf(me), dirOf(me))) return false;
  if (list.some((q) => q.color === me && q.pos.file === to.file && q.pos.rank === to.rank)) return false;
  if (list.some((q) => q.type === 'K' && q.color !== me && q.pos.file === to.file && q.pos.rank === to.rank)) return false; // un roi ne se capture pas
  return keepsKingSafe(effective(list), 8, p, to);
}

const sqEl = (s: Square) => document.querySelector<HTMLElement>(`.sq[data-f="${s.file}"][data-r="${s.rank}"]`);

/** Enregistre le coup du sous-tour actif : la pièce se déplace à l'écran. */
function place(id: string, to: Square) {
  plan[activeSub] = [{ pieceId: id, to }].slice(0, DEFAULT_RULES.maxActionsPerSubTurn);
  sfx.plan();
  selected = null;
  viewAt = activeSub + 1;
  activeSub = Math.min(activeSub + 1, 2);
  refreshPlanUi();
}

// --- Souris / tactile : clic-clic et glisser-déposer --------------------------
function squareAt(ev: PointerEvent): Square | null {
  const rect = boardEl.getBoundingClientRect();
  const col = Math.floor(((ev.clientX - rect.left) / rect.width) * 8);
  const row = Math.floor(((ev.clientY - rect.top) / rect.height) * 8);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return { file: flip() ? 7 - col : col, rank: flip() ? row : 7 - row };
}

function onPointerDown(ev: PointerEvent) {
  if (locked() || ev.button > 0) return;
  // Si l'affichage montre le résultat du dernier coup, on revient d'abord au sous-tour actif.
  if (viewAt !== activeSub) { viewAt = activeSub; selected = null; refreshPlanUi(); return; }
  const sq = squareAt(ev); if (!sq) return;
  const list = previewPieces(viewAt);
  const mine = list.find((p) => p.color === me && p.pos.file === sq.file && p.pos.rank === sq.rank);
  if (mine) {
    selected = mine.id; sfx.select();
    drag = { id: mine.id, x: ev.clientX, y: ev.clientY, active: false, pointerId: ev.pointerId };
    refreshPlanUi();
    return;
  }
  // clic-clic : destination d'une pièce déjà sélectionnée
  const p = selected ? list.find((q) => q.id === selected) : undefined;
  if (p && isLegalTarget(list, p, sq)) place(p.id, sq);
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
  el?.style.setProperty('--c', String((ev.clientX - rect.left) / rect.width * 8 - 0.5));
  el?.style.setProperty('--r', String((ev.clientY - rect.top) / rect.height * 8 - 0.5));
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
  const list = previewPieces(viewAt);
  const p = list.find((q) => q.id === d.id)!;
  if (sq && isLegalTarget(list, p, sq)) {
    place(d.id, sq);
  } else {
    refreshPlanUi(); // retour à la case d'origine
  }
}

// --- Cycle de jeu --------------------------------------------------------------
function startPlanning() {
  plan = [[], [], []]; activeSub = 0; viewAt = 0; selected = null; drag = null;
  submitted = false; busy = false; currentStep = -1;
  planBase = state.pieces.map((p) => ({ ...p, pos: { ...p.pos } }));
  deadline = Date.now() + PLAN_SECONDS * 1000;
  $('banner').hidden = true;
  clearInterval(timer);
  let lastTick = -1;
  timer = window.setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    $('clock').textContent = (left / 1000).toFixed(1);
    const bar = $('timebar') as HTMLElement;
    bar.style.width = (left / (PLAN_SECONDS * 1000)) * 100 + '%';
    bar.classList.toggle('low', left < 3000);
    const s = Math.ceil(left / 1000);
    if (left < 3000 && s !== lastTick && left > 0) { lastTick = s; sfx.tick(); }
    if (left <= 0) submit();
  }, 100);
  snapPieces(state.pieces);
  refreshPlanUi();
}

function submit() {
  if (submitted || busy || state.winner) return;
  submitted = true; clearInterval(timer); selected = null; viewAt = 3;
  if (drag?.active) endDrag(false, null);
  $('clock').textContent = '';
  if (mode === 'ai') {
    game!.submitPlan(me, plan);
    game!.submitPlan(opp(me), randomPlan(state, opp(me)));
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
    case 'capture': return { text: `<b>${n}</b> ${nm(e.attackerId)} capture ${nm(e.victimId)}`, cls: 'cap' };
    case 'collision': return { text: `<b>${n}</b> Collision en ${sqName(e.at.file, e.at.rank)} : ${e.winnerId ? nm(e.winnerId) + " l'emporte" : 'destruction mutuelle'}`, cls: 'cap' };
    case 'promotion': return { text: `<b>${n}</b> ${nm(e.pieceId)} promu en dame` };
    case 'check': return { text: `<b>${n}</b> Échec au roi ${e.color === 'white' ? 'blanc' : 'noir'} !`, cls: 'cap' };
    case 'game-over': return { text: endText(e.winner, e.reason), cls: 'cap' };
    default: return null;
  }
}

function endText(winner: Color | 'draw', reason?: string): string {
  if (reason === 'stalemate') return 'Pat : match nul.';
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
    if (!step) { finish(); return; }
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
      inner?.classList.add('lift'); window.setTimeout(() => inner?.classList.remove('lift'), 900);
    }
    if (step.events.some((e) => e.kind === 'move')) sfx.move();
    const dying = new Set(before.pieces.map((p) => p.id));
    for (const p of state.pieces) dying.delete(p.id);
    // Les victimes restent affichées le temps de l'impact : on ne synchronise que les survivantes.
    syncPieces([...state.pieces, ...before.pieces.filter((p) => dying.has(p.id))]);
    refreshPlanUi();

    // 3. Impacts, un peu après l'arrivée.
    window.setTimeout(() => {
      for (const e of step.events) {
        if (e.kind === 'capture' || e.kind === 'collision') {
          const c = pct(e.at);
          burst(fxEl, c.x, c.y, e.kind === 'collision' ? '#ffb04c' : '#ff5a6e');
          if (e.kind === 'collision') { ring(fxEl, c.x, c.y, '#ffb04c'); sfx.collision(); } else sfx.capture();
        }
        if (e.kind === 'promotion') { const c = pct(e.at); ring(fxEl, c.x, c.y, '#7dffb0'); }
      }
      for (const id of dying) { const el = pieceEls.get(id); el?.querySelector('.inner')?.classList.add('die'); window.setTimeout(() => { el?.remove(); pieceEls.delete(id); }, 600); }
    }, 780);
    window.setTimeout(next, STEP_MS);
  };
  const finish = () => {
    state = finalState; busy = false; currentStep = -1;
    syncPieces(state.pieces); refreshPlanUi();
    if (state.winner) {
      const ban = $('banner'); const won = state.winner === me;
      ban.innerHTML = `<h2>${state.winner === 'draw' ? 'Match nul' : won ? 'Victoire !' : 'Défaite'}</h2><p>${endText(state.winner, endReason)}</p><button class="primary" id="menu">Retour au menu</button>`;
      ban.className = `banner ${state.winner === 'draw' ? '' : won ? 'win' : 'lose'}`; ban.hidden = false;
      $('menu').onclick = () => showMenu();
      state.winner === me ? sfx.win() : sfx.lose();
    } else startPlanning();
  };
  refreshPlanUi();
  window.setTimeout(next, 500);
}

function $(id: string): HTMLElement { return document.getElementById(id)!; }

showMenu();
