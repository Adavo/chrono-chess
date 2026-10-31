import './style.css';
import { randomPlan } from '../ai/randomAi';
import { createInitialState } from '../core/board';
import { replaySteps } from '../core/replay';
import { Game } from '../core/sequence';
import { DEFAULT_RULES, type CancelReason, type Color, type GameEvent, type GameState, type PieceType, type PlannedAction } from '../core/types';
import { dropPeer, host, join, type Conn } from '../net/peer';
import type { GuestToHost, HostToGuest } from '../net/transport';

const PLAN_SECONDS = 10;
const STEP_MS = 1100;
const GLYPH: Record<PieceType, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const NAMES: Record<PieceType, string> = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier', P: 'Pion' };
const REASONS: Record<CancelReason, string> = {
  'piece-not-found': 'la pièce a été capturée', 'not-owner': 'pièce adverse', 'already-acted': 'déjà jouée',
  'no-move': 'pas de déplacement', 'out-of-bounds': 'hors plateau', 'illegal-geometry': 'mouvement impossible depuis sa position réelle',
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
let busy = false; // résolution en cours d'animation
let timer: number | undefined;
let logLines: { text: string; cls?: string }[] = [];
let flash: string[] = [];

const opp = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const sqName = (f: number, r: number) => 'abcdefgh'[f]! + (r + 1);
const pieceById = (id: string) => state.pieces.find((p) => p.id === id);

// --- Écrans ------------------------------------------------------------------
function showMenu(msg = '') {
  clearInterval(timer); dropPeer(); conn = null; game = null; busy = false;
  app.innerHTML = `<h1>Chrono Chess</h1>
    <p class="hint">Programmez 3 coups en secret (${PLAN_SECONDS} s), puis regardez-les se résoudre en même temps. Un coup devenu impossible est simplement perdu.</p>
    ${msg ? `<p class="cancel">${msg}</p>` : ''}
    <div class="menu">
      <button id="ai">Jouer contre l'IA</button>
      <button id="host">Créer une partie en ligne</button>
      <div class="row"><input id="code" placeholder="CODE" maxlength="5" size="6" style="text-transform:uppercase" /><button id="join">Rejoindre</button></div>
    </div>`;
  $('ai').onclick = () => { mode = 'ai'; me = 'white'; game = new Game(createInitialState()); state = game.state; startPlanning(); };
  $('host').onclick = showHost;
  $('join').onclick = () => showJoin(($('code') as HTMLInputElement).value.trim());
}

function showHost() {
  app.innerHTML = `<h1>Partie en ligne</h1><p>Donnez ce code à votre adversaire (cliquer pour copier) :</p><div class="code" id="c">…</div><p id="st" class="hint">Création…</p><button id="back">Annuler</button>`;
  $('back').onclick = () => showMenu();
  host(
    (code) => {
      $('c').textContent = code; $('st').textContent = 'En attente de l\'adversaire…';
      $('c').onclick = () => navigator.clipboard?.writeText(code).then(() => ($('st').textContent = 'Code copié.'));
    },
    (c) => {
      mode = 'host'; me = 'white'; conn = c; game = new Game(createInitialState()); state = game.state;
      c.onmsg = (m: GuestToHost) => {
        if (m.t !== 'plan' || !game || m.seq !== game.state.sequence) return; // plan périmé
        game.submitPlan('black', m.plan);
        if (submitted) hostResolve();
      };
      c.onclose = () => showMenu('Connexion perdue avec l\'adversaire.');
      c.send({ t: 'start', color: 'black', state } satisfies HostToGuest);
      startPlanning();
    },
    (e) => showMenu(e),
  );
}

function showJoin(code: string) {
  if (code.length < 5) return showMenu('Entrez un code à 5 caractères.');
  app.innerHTML = `<h1>Connexion…</h1><p class="hint">${code.toUpperCase()}</p>`;
  join(code, (c) => {
    mode = 'guest'; me = 'black'; conn = c;
    c.onmsg = (m: HostToGuest) => {
      if (m.t === 'start') { state = m.state; startPlanning(); }
      if (m.t === 'resolved') playResolution(m.events, m.state);
    };
    c.onclose = () => showMenu('Connexion perdue avec l\'hôte.');
  }, (e) => showMenu(e));
}

// --- Planification -----------------------------------------------------------
function startPlanning() {
  plan = [[], [], []]; activeSub = 0; selected = null; submitted = false; busy = false;
  deadline = Date.now() + PLAN_SECONDS * 1000;
  clearInterval(timer);
  timer = window.setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    const el = document.getElementById('clock');
    if (el) el.textContent = (left / 1000).toFixed(1) + ' s';
    if (left <= 0) submit();
  }, 100);
  render();
}

function submit() {
  if (submitted || busy) return;
  submitted = true; clearInterval(timer);
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
  render();
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
  switch (e.kind) {
    case 'move': return { text: `${e.subTurn + 1}. ${nm(e.pieceId)} ${sqName(e.from.file, e.from.rank)}→${sqName(e.to.file, e.to.rank)}` };
    case 'cancelled': return { text: `${e.subTurn + 1}. ✗ ${nm(e.pieceId)} → ${sqName(e.to.file, e.to.rank)} : ${REASONS[e.reason]}`, cls: 'cancel' };
    case 'capture': return { text: `${e.subTurn + 1}. ${nm(e.attackerId)} capture ${nm(e.victimId)}`, cls: 'cap' };
    case 'collision': return { text: `${e.subTurn + 1}. Collision en ${sqName(e.at.file, e.at.rank)} : ${e.winnerId ? nm(e.winnerId) + ' l\'emporte' : 'destruction mutuelle'}`, cls: 'cap' };
    case 'promotion': return { text: `${e.subTurn + 1}. ${nm(e.pieceId)} promu en dame` };
    case 'game-over': return { text: e.winner === 'draw' ? 'Match nul.' : `Victoire des ${e.winner === 'white' ? 'blancs' : 'noirs'} !`, cls: 'cap' };
    default: return null;
  }
}

function playResolution(events: GameEvent[], finalState: GameState) {
  busy = true; clearInterval(timer); logLines = [];
  const start = state;
  const steps = replaySteps(start, events);
  let i = 0;
  const next = () => {
    const step = steps[i++];
    if (!step) {
      state = finalState; busy = false; flash = [];
      if (state.winner) { render(); return; }
      startPlanning(); return;
    }
    for (const e of step.events) { const d = describe(e, state); if (d) logLines.push(d); }
    flash = step.events.filter((e) => e.kind === 'capture' || e.kind === 'collision').map((e) => (e.kind === 'capture' ? sqName(e.at.file, e.at.rank) : e.kind === 'collision' ? sqName(e.at.file, e.at.rank) : ''));
    state = step.state;
    render();
    window.setTimeout(next, STEP_MS);
  };
  render();
  window.setTimeout(next, 400);
}

// --- Rendu -------------------------------------------------------------------
function render() {
  const flip = me === 'black';
  const cells: string[] = [];
  const planAt = new Map<string, number[]>();
  plan.forEach((acts, t) => acts.forEach((a) => { const k = sqName(a.to.file, a.to.rank); planAt.set(k, [...(planAt.get(k) ?? []), t + 1]); }));

  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const r = flip ? row : 7 - row;
    const f = flip ? 7 - col : col;
    const p = state.grid[r * 8 + f] ? pieceById(state.grid[r * 8 + f]!) : undefined;
    const name = sqName(f, r);
    const badge = planAt.get(name);
    cells.push(`<div class="sq ${(f + r) % 2 ? 'l' : 'd'} ${p && p.id === selected ? 'sel' : ''} ${flash.includes(name) ? 'hit' : ''}" data-f="${f}" data-r="${r}">
      ${p ? `<span class="${p.color[0]}">${GLYPH[p.type]}</span>` : ''}${badge ? `<span class="plan">${badge.join(',')}</span>` : ''}</div>`);
  }

  const tabs = [0, 1, 2].map((t) => {
    const a = plan[t]![0]; const p = a && pieceById(a.pieceId);
    const label = a && p ? `${GLYPH[p.type]}→${sqName(a.to.file, a.to.rank)}` : '—';
    return `<button data-t="${t}" class="${t === activeSub ? 'active' : ''}">${t + 1} : ${label}</button>`;
  }).join('');

  const over = state.winner;
  const status = over ? (over === 'draw' ? 'Match nul' : over === me ? 'Victoire !' : 'Défaite') : busy ? 'Résolution…' : submitted ? 'Plan envoyé, en attente…' : 'Planification';
  app.innerHTML = `<div class="bar"><strong>${status}</strong><span class="clock" id="clock">${busy || submitted || over ? '' : ((deadline - Date.now()) / 1000).toFixed(1) + ' s'}</span></div>
    <div class="board">${cells.join('')}</div>
    ${over ? '<div class="row"><button id="menu">Menu</button></div>' : `
    <div class="bar"><div class="tabs">${tabs}</div><span><button id="clear">Effacer</button> <button id="ok">Valider</button></span></div>
    <p class="hint">Cliquez une de vos pièces, puis sa destination pour le sous-tour sélectionné.</p>`}
    <div class="log">${logLines.map((l) => `<div class="${l.cls ?? ''}">${l.text}</div>`).join('')}</div>`;

  const locked = busy || submitted || !!over;
  app.querySelectorAll<HTMLElement>('.sq').forEach((el) => (el.onclick = () => !locked && onSquare(+el.dataset.f!, +el.dataset.r!)));
  app.querySelectorAll<HTMLElement>('.tabs button').forEach((el) => (el.onclick = () => { if (!locked) { activeSub = +el.dataset.t!; selected = null; render(); } }));
  document.getElementById('clear')?.addEventListener('click', () => { if (!locked) { plan[activeSub] = []; render(); } });
  document.getElementById('ok')?.addEventListener('click', submit);
  document.getElementById('menu')?.addEventListener('click', () => showMenu());
  const logEl = app.querySelector('.log'); if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

function onSquare(f: number, r: number) {
  const here = state.pieces.find((p) => p.pos.file === f && p.pos.rank === r);
  if (here && here.color === me) { selected = here.id; render(); return; }
  if (!selected) return;
  plan[activeSub] = [{ pieceId: selected, to: { file: f, rank: r } }].slice(0, DEFAULT_RULES.maxActionsPerSubTurn);
  selected = null;
  const free = plan.findIndex((a) => a.length === 0);
  if (free >= 0) activeSub = free;
  render();
}

function $(id: string): HTMLElement { return document.getElementById(id)!; }

showMenu();
