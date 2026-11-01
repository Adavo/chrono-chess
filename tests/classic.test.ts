import { describe, expect, it } from 'vitest';
import { createCustomState, createInitialState } from '../src/core/board';
import { insufficientMaterial } from '../src/core/check';
import { ClassicGame, classicOutcome, legalMoves, positionKey, turnOf } from '../src/core/classic';
import { DEFAULT_RULES } from '../src/core/types';
import { resolvePlans } from '../src/core/resolution';

const P = (file: number, rank: number) => ({ file, rank });
type Piece = Parameters<typeof createCustomState>[0][number];
const kings: Piece[] = [
  { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 },
  { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
];

describe('mode classique : coups légaux', () => {
  it('depuis la position de départ : 5 pas de pion et 2 coups de cavalier', () => {
    const s = createInitialState();
    expect(legalMoves(s.pieces, 5, 'white')).toHaveLength(7);
    expect(legalMoves(s.pieces, 5, 'black')).toHaveLength(7);
  });

  it('les trajectoires sont bloquées par toute pièce', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 2 }, { id: 'bP', type: 'P', color: 'black', file: 2, rank: 2 }]);
    const targets = legalMoves(s.pieces, 5, 'white').filter((m) => m.pieceId === 'wR').map((m) => `${m.to.file},${m.to.rank}`);
    expect(targets).toContain('2,2'); // capture du pion
    expect(targets).not.toContain('3,2'); // derrière le pion
  });

  it("aucun coup ne laisse ou ne met le roi en échec, même pour une pièce clouée", () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 2, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 4 },
      { id: 'bR', type: 'R', color: 'black', file: 2, rank: 4 }, { id: 'wR', type: 'R', color: 'white', file: 2, rank: 2 },
    ]);
    const wr = legalMoves(s.pieces, 5, 'white').filter((m) => m.pieceId === 'wR').map((m) => `${m.to.file},${m.to.rank}`);
    expect(wr.every((t) => t.startsWith('2,'))).toBe(true); // la tour clouée reste sur la colonne du roi
  });
});

describe('ClassicGame', () => {
  it('les blancs commencent, on joue à tour de rôle, un coup illégal ou hors tour est refusé', () => {
    const g = new ClassicGame(createInitialState());
    expect(g.turn).toBe('white');
    expect(g.play('black', { pieceId: 'bP2', to: P(2, 2) })).toBeNull(); // pas son tour
    expect(g.play('white', { pieceId: 'wR0', to: P(0, 2) })).toBeNull(); // trajectoire bloquée par son pion
    const ev = g.play('white', { pieceId: 'wP2', to: P(2, 2) });
    expect(ev).not.toBeNull();
    expect(g.state.sequence).toBe(1);
    expect(g.turn).toBe('black');
    expect(turnOf(g.state)).toBe('black');
    expect(g.play('white', { pieceId: 'wP1', to: P(1, 2) })).toBeNull();
  });

  it("une capture classique : la pièce qui bouge l'emporte, quelle que soit sa force", () => {
    const g = new ClassicGame(createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 1, rank: 2 }, { id: 'bR', type: 'R', color: 'black', file: 2, rank: 3 }]));
    g.play('white', { pieceId: 'wP', to: P(2, 3) });
    expect(g.state.pieces.find((p) => p.id === 'bR')).toBeUndefined();
    expect(g.state.pieces.find((p) => p.id === 'wP')!.pos).toEqual(P(2, 3));
  });

  it('échec et mat : la partie est jugée tout de suite', () => {
    // Noirs à jouer : Tour b -> a3 donne mat au roi blanc en a1 (l'autre tour couvre la colonne b).
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
      { id: 'bA', type: 'R', color: 'black', file: 1, rank: 3 }, { id: 'bB', type: 'R', color: 'black', file: 3, rank: 2 },
    ]);
    s.sequence = 1;
    const g = new ClassicGame(s);
    const ev = g.play('black', { pieceId: 'bB', to: P(0, 2) });
    expect(g.state.winner).toBe('black');
    expect(ev!.find((e) => e.kind === 'game-over')).toMatchObject({ reason: 'checkmate' });
    expect(g.play('white', { pieceId: 'wK', to: P(0, 1) })).toBeNull();
  });

  it('pat et deux rois seuls : nulle', () => {
    const stale = createCustomState([
      ...kings,
      { id: 'bA', type: 'R', color: 'black', file: 1, rank: 3 }, { id: 'bB', type: 'R', color: 'black', file: 4, rank: 1 },
    ]);
    expect(classicOutcome(stale.pieces, 5, 'white')).toMatchObject({ winner: 'draw', reason: 'stalemate' });
    expect(classicOutcome(createCustomState(kings).pieces, 5, 'white')).toMatchObject({ winner: 'draw', reason: 'insufficient' });
  });

  it('un roi en échec doit le parer ; la promotion demandée est respectée', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 2, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 4 },
      { id: 'bR', type: 'R', color: 'black', file: 2, rank: 3 }, { id: 'wP', type: 'P', color: 'white', file: 4, rank: 3 },
    ]);
    const g = new ClassicGame(s);
    expect(g.play('white', { pieceId: 'wP', to: P(4, 4) })).toBeNull(); // ne pare pas l'échec
    const s2 = createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 2, rank: 3 }]);
    const g2 = new ClassicGame(s2);
    g2.play('white', { pieceId: 'wP', to: P(2, 4), promo: 'B' });
    expect(g2.state.pieces.find((p) => p.id === 'wP')!.type).toBe('B');
  });
});

describe('nulle : matériel insuffisant', () => {
  const withExtra = (...extra: Piece[]) => createCustomState([...kings, ...extra]).pieces;
  const at = (id: string, type: Piece['type'], color: Piece['color'], file: number, rank: number): Piece => ({ id, type, color, file, rank });

  it('deux rois, ou un seul cavalier / fou en plus (quel que soit le camp) : aucun mat possible', () => {
    expect(insufficientMaterial(withExtra())).toBe(true);
    for (const type of ['N', 'B'] as const) for (const color of ['white', 'black'] as const) {
      expect(insufficientMaterial(withExtra(at('x', type, color, 2, 2)))).toBe(true);
    }
  });

  it('tour, dame ou pion (promotion possible) : le mat reste possible', () => {
    for (const type of ['R', 'Q', 'P'] as const) expect(insufficientMaterial(withExtra(at('x', type, 'white', 2, 2)))).toBe(false);
  });

  it('deux pièces mineures : un mat reste possible sur 5x5 (le roi se bloque avec ses pièces)', () => {
    expect(insufficientMaterial(withExtra(at('a', 'N', 'white', 2, 2), at('b', 'N', 'white', 3, 2)))).toBe(false);
    expect(insufficientMaterial(withExtra(at('a', 'B', 'white', 2, 2), at('b', 'B', 'black', 3, 2)))).toBe(false);
  });

  it('la partie est déclarée nulle dès que la prise laisse un roi et un fou contre un roi', () => {
    const g = new ClassicGame(createCustomState([
      ...kings, at('wR', 'R', 'white', 1, 2), at('bB', 'B', 'black', 1, 3),
    ]));
    g.play('white', { pieceId: 'wR', to: P(1, 3) });
    expect(g.state.pieces.map((p) => p.id).sort()).toEqual(['bK', 'wK', 'wR']); // tour restante : pas nulle
    expect(g.state.winner).toBeNull();
    const g2 = new ClassicGame(createCustomState([...kings, at('wN', 'N', 'white', 1, 2), at('bR', 'R', 'black', 2, 4)]));
    g2.play('white', { pieceId: 'wN', to: P(2, 4) });
    expect(g2.state.winner).toBe('draw');
  });
});

describe('nulle : même position trois fois', () => {
  const shuffle = () => new ClassicGame(createCustomState([
    ...kings,
    { id: 'wR', type: 'R', color: 'white', file: 1, rank: 0 },
    { id: 'bR', type: 'R', color: 'black', file: 3, rank: 4 },
  ]));
  const cycle = [['white', 'wR', P(1, 1)], ['black', 'bR', P(3, 3)], ['white', 'wR', P(1, 0)], ['black', 'bR', P(3, 4)]] as const;

  it('la troisième occurrence met fin à la partie, pas la deuxième', () => {
    const g = shuffle();
    const events: ReturnType<ClassicGame['play']>[] = [];
    for (let i = 0; i < 8; i++) {
      const [color, pieceId, to] = cycle[i % 4]!;
      expect(g.state.winner).toBeNull();
      events.push(g.play(color, { pieceId, to }));
      if (i === 3) expect(g.state.winner).toBeNull(); // 2e fois : on continue
    }
    expect(g.state.winner).toBe('draw');
    expect(events.at(-1)!.find((e) => e.kind === 'game-over')).toMatchObject({ winner: 'draw', reason: 'repetition' });
  });

  it('le camp au trait compte : même disposition mais autre trait = autre position', () => {
    const a = shuffle().state;
    const b = { ...a, sequence: 1 };
    expect(positionKey(a)).not.toBe(positionKey(b));
  });

  it('un coup irréversible (pion) repart de zéro, les positions précédentes ne comptent plus', () => {
    const g = new ClassicGame(createCustomState([
      ...kings,
      { id: 'wR', type: 'R', color: 'white', file: 1, rank: 0 },
      { id: 'bR', type: 'R', color: 'black', file: 3, rank: 4 },
      { id: 'wP', type: 'P', color: 'white', file: 0, rank: 1 },
    ]));
    for (let i = 0; i < 4; i++) g.play(cycle[i]![0], { pieceId: cycle[i]![1], to: cycle[i]![2] }); // position de départ vue 2 fois
    g.play('white', { pieceId: 'wP', to: P(0, 2) }); // jamais défait
    // Noirs au trait : on refait un cycle complet (noirs, blancs, noirs, blancs).
    const after = [cycle[1]!, cycle[0]!, cycle[3]!, cycle[2]!];
    for (let i = 0; i < 4; i++) g.play(after[i]![0], { pieceId: after[i]![1], to: after[i]![2] });
    expect(g.state.winner).toBeNull(); // 2e fois seulement (l'ancien cycle ne compte plus)
    for (let i = 0; i < 4; i++) g.play(after[i]![0], { pieceId: after[i]![1], to: after[i]![2] });
    expect(g.state.winner).toBe('draw'); // 3e fois
  });
});

describe('mode B : un seul coup simultané', () => {
  it('résolu comme les autres modes, avec subTurns = 1', () => {
    const rules = { ...DEFAULT_RULES, subTurns: 1 };
    const s = createInitialState();
    const r = resolvePlans(s, { white: [[{ pieceId: 'wP2', to: P(2, 2) }]], black: [[{ pieceId: 'bP2', to: P(2, 2) }]] }, rules);
    expect(r.events.filter((e) => e.kind === 'sub-turn-start')).toHaveLength(1);
    expect(r.state.sequence).toBe(1);
    // arrivée simultanée de deux pions sur la même case : ils s'annulent
    expect(r.state.pieces.find((p) => p.id === 'wP2')).toBeUndefined();
    expect(r.state.pieces.find((p) => p.id === 'bP2')).toBeUndefined();
  });
});
