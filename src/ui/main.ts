import './style.css';
import { randomPlan } from '../ai/randomAi';
import { createInitialState } from '../core/board';
import { checkMove } from '../core/moves';
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
const NAMES: Record<PieceType, string> = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier', P: 'Pion' };
const REASONS: Record<CancelReason, string> = {
  'piece-not-found': 'la pièce a été capturée', 'not-owner': 'pièce adverse', 'already-acted': 'déjà jouée',
  'no-move': 'pas de déplacement', 'out-of-bounds': 'hors plateau', 'illegal-geometry': 'impossible depuis sa position réelle',
  'path-blocked': 'trajectoire bloquée', 'friendly-occupied': 'case alliée', 'blocked-forward': 'pion bloqué',
  'no-capture-target': 'rien à capturer', 'target-moved': 'la cible est partie', 'ally-conflict': 'un allié visait la même case',
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
let activeSub = 0;
let selected: string | null = null;
let deadline = 0;
let submitted = false;
let busy = false;
let currentStep = -1; // sous-tour affiché pendant la résolution
let planBase: PieceState[] = []; // pièces au début de la Séquence (point de départ des flèches)
let timer: number | undefined;
let logLines: { text: string; cls?: string }[] = [];

const opp = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const sqName = (f: number, r: number) => 'abcdefgh'[f]! + (r + 1);
const pieceById = (id: string) => state.pieces.find((p) => p.id === id);
const flip = () => me === 'black';
/** Case logique -> colonne/ligne à l'écran (le joueur noir voit le plateau retourné). */
const disp = (s: Square) => ({ c: flip() ? 7 - s.file : s.file, row: flip() ? s.rank : 7 - s.rank });
const pct = (s: Square) => { const d = disp(s); return { x: (d.c + 0.5) * 12.5, y: (d.row + 0.5) * 12.5 }; };

// --- Références DOM de l'écran de jeu ---------------------------------------
let boardEl: HTMLElement, piecesEl: HTMLElement, fxEl: HTMLElement, arrowsEl: SVGSVGElement;
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
  pieceEls.clear(); logLines = [];
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
        <svg class="layer arrows" id="arrows" viewBox="0 0 8 8" preserveAspectRatio="none"></svg>
        <div class="layer" id="fx"></div>
        <div class="banner" id="banner" hidden></div>
      </div>
    </div>
    <div class="pips" id="pips">${[0, 1, 2].map((t) => `<span style="--c:${SUB_COLORS[t]}">${t + 1}</span>`).join('')}</div>
    <div class="slots" id="slots"></div>
    <div class="row actions"><button id="clear">Effacer ce coup</button><button class="primary" id="ok">Valider</button></div>
    <div class="log" id="log"></div>`;
  boardEl = $('board'); piecesEl = $('pieces'); fxEl = $('fx'); arrowsEl = $('arrows') as unknown as SVGSVGElement;

  boardEl.addEventListener('click', (ev) => {
    const sq = (ev.target as HTMLElement).closest<HTMLElement>('.sq');
    if (sq && !locked()) onSquare(+sq.dataset.f!, +sq.dataset.r!);
  });
  $('clear').onclick = () => { if (!locked()) { plan[activeSub] = []; selected = null; refreshPlanUi(); } };
  $('ok').onclick = submit;
  const mute = $('mute');
  const paintMute = () => (mute.textContent = isMuted() ? '🔇' : '🔊');
  mute.onclick = () => { setMuted(!isMuted()); paintMute(); };
  paintMute();
  syncPieces();
  refreshPlanUi();
}

const locked = () => busy || submitted || !!state.winner;

// --- Pièces (éléments persistants : elles glissent d'une case à l'autre) -----
function syncPieces() {
  const alive = new Set(state.pieces.map((p) => p.id));
  for (const p of state.pieces) {
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
  }
  for (const [id, el] of [...pieceEls]) if (!alive.has(id)) { pieceEls.delete(id); el.remove(); }
}

/** Position supposée d'une pièce au sous-tour t si ses propres coups précédents réussissent. */
function projected(id: string, t: number): { pos: Square; moved: boolean } {
  const p = planBase.find((q) => q.id === id) ?? pieceById(id)!; // état figé au début de la Séquence
  let pos = p.pos; let moved = p.hasMoved;
  for (let i = 0; i < t; i++) {
    const a = plan[i]![0];
    if (a && a.pieceId === id) { pos = a.to; moved = true; }
  }
  return { pos, moved };
}

// --- Interface de planification ----------------------------------------------
function refreshPlanUi() {
  // Statut
  const over = state.winner;
  $('status').textContent = over ? (over === 'draw' ? 'Match nul' : over === me ? 'Victoire !' : 'Défaite')
    : busy ? 'Résolution' : submitted ? 'Plan envoyé… en attente' : 'Planifiez vos 3 coups';
  // Cases : sélection + aides
  boardEl.querySelectorAll('.sq').forEach((el) => el.classList.remove('sel', 'hint', 'hint-cap'));
  piecesEl.querySelectorAll('.piece').forEach((el) => el.classList.remove('selected'));
  if (selected && !locked()) {
    const p = pieceById(selected)!;
    const pr = projected(selected, activeSub);
    document.querySelector<HTMLElement>(`.sq[data-f="${pr.pos.file}"][data-r="${pr.pos.rank}"]`)?.classList.add('sel');
    pieceEls.get(selected)?.classList.add('selected');
    const byId = new Map(state.pieces.map((q) => [q.id, q]));
    const snap = { size: 8, at: (s: Square) => { const id = state.grid[s.rank * 8 + s.file]; return id ? byId.get(id) : undefined; } };
    const ghost: PieceState = { ...p, pos: pr.pos, hasMoved: pr.moved };
    const dir = p.color === 'white' ? 1 : -1;
    for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) {
      const c = checkMove(snap, ghost, { file: f, rank: r }, p.color === 'white' ? 1 : 6, dir);
      if (c.ok) document.querySelector<HTMLElement>(`.sq[data-f="${f}"][data-r="${r}"]`)?.classList.add(c.capture ? 'hint-cap' : 'hint');
    }
  }
  // Cartes des 3 sous-tours
  $('slots').innerHTML = [0, 1, 2].map((t) => {
    const a = plan[t]![0]; const p = a && pieceById(a.pieceId);
    const from = a && p ? projected(a.pieceId, t).pos : null;
    const body = a && p && from
      ? `<span class="mini ${p.color[0]}">${pieceSvg(p.type)}</span><b>${NAMES[p.type]}</b><span>${sqName(from.file, from.rank)} → ${sqName(a.to.file, a.to.rank)}</span>`
      : '<span class="empty">Aucun coup</span>';
    return `<button class="slot ${t === activeSub ? 'active' : ''} ${currentStep === t ? 'now' : ''}" data-t="${t}" style="--c:${SUB_COLORS[t]}"><em>${t + 1}</em>${body}</button>`;
  }).join('');
  $('slots').querySelectorAll<HTMLElement>('.slot').forEach((el) => (el.onclick = () => { if (!locked()) { activeSub = +el.dataset.t!; selected = null; refreshPlanUi(); } }));
  $('pips').querySelectorAll('span').forEach((el, i) => el.classList.toggle('on', i === currentStep));
  ($('ok') as HTMLButtonElement).disabled = locked();
  ($('clear') as HTMLButtonElement).disabled = locked();
  $('log').innerHTML = logLines.map((l) => `<div class="${l.cls ?? ''}">${l.text}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;
  renderArrows();
}

/** Flèches de programmation colorées par sous-tour (la plus récente / active est plus épaisse). */
function renderArrows() {
  let svg = '';
  plan.forEach((acts, t) => {
    const a = acts[0]; if (!a || !pieceById(a.pieceId)) return;
    const from = disp(projected(a.pieceId, t).pos); const to = disp(a.to);
    const x1 = from.c + 0.5, y1 = from.row + 0.5, x2 = to.c + 0.5, y2 = to.row + 0.5;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const head = 0.3; const bx = x2 - ux * head * 1.2, by = y2 - uy * head * 1.2;
    const col = SUB_COLORS[t]!;
    const dim = currentStep >= 0 && currentStep !== t ? 0.15 : t === activeSub && currentStep < 0 ? 1 : 0.7;
    svg += `<g opacity="${dim}"><line x1="${x1 + ux * 0.25}" y1="${y1 + uy * 0.25}" x2="${bx}" y2="${by}" stroke="${col}" stroke-width="${t === activeSub ? 0.13 : 0.09}" stroke-linecap="round"/>
      <polygon points="${x2},${y2} ${bx - uy * head * 0.7},${by + ux * head * 0.7} ${bx + uy * head * 0.7},${by - ux * head * 0.7}" fill="${col}"/>
      <circle cx="${x2 + 0.27}" cy="${y2 - 0.27}" r="0.2" fill="#0b0e17" stroke="${col}" stroke-width="0.05"/>
      <text x="${x2 + 0.27}" y="${y2 - 0.27 + 0.085}" text-anchor="middle" font-size="0.26" font-weight="800" fill="${col}">${t + 1}</text></g>`;
  });
  arrowsEl.innerHTML = svg;
}

function onSquare(f: number, r: number) {
  // Sélection d'une de ses pièces (ou, si elle vise déjà cette case, elle reste ciblable)
  const here = state.pieces.find((p) => p.pos.file === f && p.pos.rank === r);
  if (here && here.color === me) { selected = here.id; sfx.select(); refreshPlanUi(); return; }
  if (!selected) return;
  plan[activeSub] = [{ pieceId: selected, to: { file: f, rank: r } }].slice(0, DEFAULT_RULES.maxActionsPerSubTurn);
  sfx.plan();
  selected = null;
  const free = plan.findIndex((a) => a.length === 0);
  if (free >= 0) activeSub = free;
  refreshPlanUi();
}

// --- Cycle de jeu --------------------------------------------------------------
function startPlanning() {
  plan = [[], [], []]; activeSub = 0; selected = null; submitted = false; busy = false; currentStep = -1;
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
  syncPieces();
  refreshPlanUi();
}

function submit() {
  if (submitted || busy || state.winner) return;
  submitted = true; clearInterval(timer); selected = null;
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
    case 'game-over': return { text: e.winner === 'draw' ? 'Match nul.' : `Victoire des ${e.winner === 'white' ? 'blancs' : 'noirs'} !`, cls: 'cap' };
    default: return null;
  }
}

function playResolution(events: GameEvent[], finalState: GameState) {
  busy = true; clearInterval(timer); logLines = []; selected = null;
  $('clock').textContent = ''; ($('timebar') as HTMLElement).style.width = '0%';
  const steps = replaySteps(state, events);
  let i = 0;
  const next = () => {
    const step = steps[i++];
    if (!step) { finish(); return; }
    currentStep = step.subTurn;
    const before = state;
    for (const e of step.events) { const d = describe(e, before); if (d) logLines.push(d); }

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
    for (const id of dying) pieceEls.get(id)?.classList.add('arriving-victim');
    syncPieces(); // positions (les victimes restent le temps de l'impact)
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
      for (const id of dying) { const el = pieceEls.get(id); el?.querySelector('.inner')?.classList.add('die'); window.setTimeout(() => el?.remove(), 600); }
    }, 780);
    window.setTimeout(next, STEP_MS);
  };
  const finish = () => {
    state = finalState; busy = false; currentStep = -1;
    syncPieces(); refreshPlanUi();
    if (state.winner) {
      const ban = $('banner'); const won = state.winner === me;
      ban.innerHTML = `<h2>${state.winner === 'draw' ? 'Match nul' : won ? 'Victoire !' : 'Défaite'}</h2><button class="primary" id="menu">Retour au menu</button>`;
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
