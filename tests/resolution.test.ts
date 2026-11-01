import { describe, expect, it } from 'vitest';
import { createCustomState, createInitialState } from '../src/core/board';
import { resolvePlans } from '../src/core/resolution';
import { Game } from '../src/core/sequence';
import { DEFAULT_RULES, type Color, type GameEvent, type PieceType, type Plan } from '../src/core/types';

const P = (file: number, rank: number) => ({ file, rank });
const act = (pieceId: string, file: number, rank: number) => [{ pieceId, to: P(file, rank) }];
const none: Plan = [[], [], [], [], []];
/** Complète une suite de sous-tours (au plus 5) avec des sous-tours vides. */
const plan = (...turns: Plan[number][]): Plan => [...turns, ...none].slice(0, 5);
const plans = (white: Plan, black: Plan = none): Record<Color, Plan> => ({ white, black });
const cancelled = (ev: GameEvent[]) => ev.filter((e) => e.kind === 'cancelled') as Extract<GameEvent, { kind: 'cancelled' }>[];
type Piece = Parameters<typeof createCustomState>[0][number];
// Rois de base : blanc en (0,0), noir en (4,4).
const kings: Piece[] = [
  { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 },
  { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
];
const find = (s: ReturnType<typeof createCustomState>, id: string) => s.pieces.find((p) => p.id === id);

describe('position de départ 5x5', () => {
  it('Tour, Fou, Roi, Cavalier, Tour + 5 pions de chaque côté', () => {
    const s = createInitialState();
    expect(s.size).toBe(5);
    expect(s.pieces).toHaveLength(20);
    const row = (rank: number) => [0, 1, 2, 3, 4].map((f) => s.pieces.find((p) => p.pos.file === f && p.pos.rank === rank)!.type).join('');
    expect(row(0)).toBe('RBKNR');
    expect(row(4)).toBe('RBKNR');
    expect(row(1)).toBe('PPPPP');
    expect(row(3)).toBe('PPPPP');
  });
});

describe('collisions classiques : les pièces immobiles bloquent', () => {
  const rookBoard = (blocker: Piece) =>
    createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 2 }, blocker]);

  it('une tour ne traverse ni un pion allié ni un pion adverse', () => {
    for (const color of ['white', 'black'] as const) {
      const s = rookBoard({ id: 'X', type: 'P', color, file: 2, rank: 2 });
      const r = resolvePlans(s, plans(plan(act('wR', 4, 2))));
      expect(cancelled(r.events)[0]?.reason).toBe('path-blocked');
      expect(find(r.state, 'wR')!.pos).toEqual(P(0, 2));
    }
  });

  it('une pièce qui arrive sur une pièce ennemie immobile la capture, même plus forte', () => {
    const s = createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 1, rank: 2 }, { id: 'bR', type: 'R', color: 'black', file: 2, rank: 3 }]);
    const r = resolvePlans(s, plans(plan(act('wP', 2, 3))));
    expect(find(r.state, 'bR')).toBeUndefined();
    expect(find(r.state, 'wP')!.pos).toEqual(P(2, 3));
  });

  it("un coup impossible depuis la position réelle est caduc, sans correctif", () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 1, rank: 2 }]);
    const r = resolvePlans(s, plans(plan(act('wR', 3, 3))));
    expect(cancelled(r.events)[0]?.reason).toBe('illegal-geometry');
    expect(find(r.state, 'wR')!.pos).toEqual(P(1, 2));
  });

  it("annule l'action d'une pièce détruite plus tôt", () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 1, rank: 2 }, { id: 'bB', type: 'B', color: 'black', file: 3, rank: 2 }]);
    const r = resolvePlans(s, plans(plan(act('wR', 3, 2)), plan([], [], act('bB', 2, 3))));
    expect(find(r.state, 'bB')).toBeUndefined();
    expect(cancelled(r.events)).toMatchObject([{ pieceId: 'bB', reason: 'piece-not-found' }]);
  });

  it('le pion avance de 1 case, jamais de 2, et est bloqué par toute pièce', () => {
    const s = createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 2, rank: 1 }, { id: 'bP', type: 'P', color: 'black', file: 2, rank: 2 }]);
    const r = resolvePlans(s, plans(plan(act('wP', 2, 2), act('wP', 2, 3))));
    expect(cancelled(r.events).map((c) => c.reason)).toEqual(['blocked-forward', 'illegal-geometry']);
    expect(find(r.state, 'wP')!.pos).toEqual(P(2, 1));
  });

  it('la même pièce peut jouer à chaque sous-tour (5 coups)', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 2 }]);
    const r = resolvePlans(s, plans(plan(act('wR', 3, 2), act('wR', 3, 0), act('wR', 1, 0), act('wR', 1, 3), act('wR', 4, 3))));
    expect(cancelled(r.events)).toHaveLength(0);
    expect(find(r.state, 'wR')!.pos).toEqual(P(4, 3));
  });

  it('promotion au hasard en cavalier, fou ou tour', () => {
    const s = createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 2, rank: 3 }]);
    const promoted = (rnd: number) => find(resolvePlans(s, plans(plan(act('wP', 2, 4))), DEFAULT_RULES, () => rnd).state, 'wP')!.type;
    expect([promoted(0), promoted(0.5), promoted(0.99)]).toEqual(['N', 'B', 'R']);
    expect(['N', 'B', 'R']).toContain(find(resolvePlans(s, plans(plan(act('wP', 2, 4)))).state, 'wP')!.type);
  });
});

describe('pièces en mouvement : elles se croisent sans rien se faire', () => {
  it('deux tours qui se croisent en chemin arrivent toutes les deux', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 2 }, { id: 'bR', type: 'R', color: 'black', file: 2, rank: 4 }]);
    const r = resolvePlans(s, plans(plan(act('wR', 4, 2)), plan(act('bR', 2, 0))));
    expect(cancelled(r.events)).toHaveLength(0);
    expect(find(r.state, 'wR')!.pos).toEqual(P(4, 2));
    expect(find(r.state, 'bR')!.pos).toEqual(P(2, 0));
  });

  it('un échange de cases est permis (chacun quitte sa case)', () => {
    const s = createCustomState([...kings, { id: 'wN', type: 'N', color: 'white', file: 1, rank: 1 }, { id: 'bN', type: 'N', color: 'black', file: 2, rank: 3 }]);
    const r = resolvePlans(s, plans(plan(act('wN', 2, 3)), plan(act('bN', 1, 1))));
    expect(find(r.state, 'wN')!.pos).toEqual(P(2, 3));
    expect(find(r.state, 'bN')!.pos).toEqual(P(1, 1));
  });

  it('une case alliée occupée au début du sous-tour bloque, même si l\'allié part', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 2 }, { id: 'wB', type: 'B', color: 'white', file: 2, rank: 2 }]);
    const r = resolvePlans(s, { white: [[...act('wR', 2, 2), ...act('wB', 3, 3)], [], [], [], []], black: none }, { ...DEFAULT_RULES, maxActionsPerSubTurn: 2 });
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wR', reason: 'friendly-occupied' });
  });

  it('deux alliés sur la même case : le second est caduc', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 2 }, { id: 'wB', type: 'B', color: 'white', file: 1, rank: 1 }]);
    const r = resolvePlans(s, { white: [[...act('wR', 2, 2), ...act('wB', 2, 2)], [], [], [], []], black: none }, { ...DEFAULT_RULES, maxActionsPerSubTurn: 2 });
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wB', reason: 'ally-conflict' });
  });

  it('capture en diagonale du pion annulée si la cible part', () => {
    const s = createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 1, rank: 2 }, { id: 'bP', type: 'P', color: 'black', file: 2, rank: 3 }]);
    const r = resolvePlans(s, plans(plan(act('wP', 2, 3)), plan(act('bP', 2, 2))));
    expect(cancelled(r.events)[0]?.reason).toBe('target-moved');
  });
});

describe('arrivée simultanée sur la même case : la plus forte reste (Roi > Tour > Cavalier > Fou > Pion)', () => {
  const WHITE_FROM: Partial<Record<PieceType, [number, number]>> = { R: [3, 0], B: [2, 4], N: [1, 2], P: [3, 2] };
  const BLACK_FROM: Partial<Record<PieceType, [number, number]>> = { R: [3, 4], B: [4, 2], N: [1, 4], P: [3, 4] };

  /** Le blanc `a` se rend en (3,3), le noir `b` aussi. */
  const duel = (a: PieceType, b: PieceType) => {
    const s = createCustomState([...kings,
      { id: 'wX', type: a, color: 'white', file: WHITE_FROM[a]![0], rank: WHITE_FROM[a]![1] },
      { id: 'bX', type: b, color: 'black', file: BLACK_FROM[b]![0], rank: BLACK_FROM[b]![1] }]);
    return resolvePlans(s, plans(plan(act('wX', 3, 3)), plan(act('bX', 3, 3))));
  };

  it('la plus forte reste, quel que soit son camp', () => {
    for (const [strong, weak] of [['R', 'N'], ['N', 'B'], ['B', 'P']] as const) {
      const r = duel(weak, strong);
      expect(cancelled(r.events)).toHaveLength(0);
      expect(find(r.state, 'wX')).toBeUndefined();
      expect(find(r.state, 'bX')!.pos).toEqual(P(3, 3));
      const r2 = duel(strong, weak);
      expect(find(r2.state, 'bX')).toBeUndefined();
      expect(find(r2.state, 'wX')!.pos).toEqual(P(3, 3));
    }
  });

  it('même force : destruction mutuelle', () => {
    const r = duel('N', 'N');
    expect(find(r.state, 'wX')).toBeUndefined();
    expect(find(r.state, 'bX')).toBeUndefined();
  });
});

describe("règle d'échec : libre pendant la manche, obligatoire seulement si le roi est en échec au départ", () => {
  // Roi blanc en (2,0) attaqué par la tour noire en (2,4) le long de la colonne 2.
  const inCheckBoard = (wR: [number, number] = [4, 2]) => createCustomState([
    { id: 'wK', type: 'K', color: 'white', file: 2, rank: 0 },
    { id: 'bK', type: 'K', color: 'black', file: 0, rank: 4 },
    { id: 'bR', type: 'R', color: 'black', file: 2, rank: 4 },
    { id: 'wR', type: 'R', color: 'white', file: wR[0], rank: wR[1] },
  ]);

  it("annule un coup qui ne résout pas l'échec", () => {
    const r = resolvePlans(inCheckBoard(), plans(plan(act('wR', 4, 3))));
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wR', reason: 'king-in-check' });
  });

  it("accepte l'interposition, la fuite et la capture de l'attaquant", () => {
    expect(cancelled(resolvePlans(inCheckBoard(), plans(plan(act('wR', 2, 2)))).events)).toHaveLength(0);
    expect(cancelled(resolvePlans(inCheckBoard(), plans(plan(act('wK', 1, 0)))).events)).toHaveLength(0);
    const take = resolvePlans(inCheckBoard([4, 4]), plans(plan(act('wR', 2, 4))));
    expect(cancelled(take.events)).toHaveLength(0);
    expect(find(take.state, 'bR')).toBeUndefined();
  });

  it("roi en échec au départ : tant qu'il l'est, tout coup qui ne le sauve pas est annulé", () => {
    const r = resolvePlans(inCheckBoard(), plans(plan(act('wR', 4, 3), act('wR', 4, 3))));
    expect(cancelled(r.events).map((c) => [c.subTurn, c.reason])).toEqual([[0, 'king-in-check'], [1, 'king-in-check']]);
  });

  it("une fois sorti d'échec, on bouge de nouveau librement (même pour se remettre en échec)", () => {
    const r = resolvePlans(inCheckBoard(), plans(plan(act('wK', 1, 0), act('wK', 2, 0), act('wR', 4, 3))));
    expect(cancelled(r.events)).toHaveLength(0);
    expect(find(r.state, 'wK')!.pos).toEqual(P(2, 0));
  });

  it('roi pas en échec au départ : on bouge librement, même en exposant son roi', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 2, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 4 },
      { id: 'bR', type: 'R', color: 'black', file: 2, rank: 4 }, { id: 'wR', type: 'R', color: 'white', file: 2, rank: 2 },
    ]);
    // la tour clouée quitte la ligne, puis le roi va se promener sur des cases attaquées
    const r = resolvePlans(s, plans(plan(act('wR', 0, 2), act('wK', 3, 0), act('wK', 3, 1), act('wK', 2, 1))));
    expect(cancelled(r.events)).toHaveLength(0);
    expect(find(r.state, 'wK')!.pos).toEqual(P(2, 1));
  });

  it("un échec donné en cours de manche n'oblige à rien avant la manche suivante", () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 2, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 4 },
      { id: 'bR', type: 'R', color: 'black', file: 0, rank: 3 }, { id: 'wR', type: 'R', color: 'white', file: 4, rank: 2 },
    ]);
    // la tour noire met le roi blanc en échec au 1er coup ; au 2e, blanc joue autre chose sans être annulé
    const r = resolvePlans(s, plans(plan([], act('wR', 4, 3)), plan(act('bR', 2, 3))));
    expect(cancelled(r.events)).toHaveLength(0);
    expect(find(r.state, 'wR')!.pos).toEqual(P(4, 3));
  });

  it('un roi ne se capture jamais', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 4, rank: 0 }]);
    const r = resolvePlans(s, plans(plan(act('wR', 4, 4))));
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wR', reason: 'king-capture' });
    expect(find(r.state, 'bK')).toBeDefined();
  });
});

describe('fin de partie : verdict à la fin des 5 coups seulement', () => {
  // Mat en (0,0) : une tour noire en (1,3) couvre (1,0) et (1,1), l'autre arrive en (0,2) (échec, couvre (0,1)).
  const board = () => createCustomState([
    { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 },
    { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
    { id: 'bA', type: 'R', color: 'black', file: 1, rank: 3 },
    { id: 'bB', type: 'R', color: 'black', file: 3, rank: 2 },
    { id: 'wP', type: 'P', color: 'white', file: 2, rank: 1 },
  ]);

  it('mat au 3e coup : les 4e et 5e coups sont joués, le verdict n\'arrive qu\'à la fin', () => {
    const r = resolvePlans(board(), plans(
      plan([], [], [], act('wP', 2, 2), act('wP', 2, 3)),
      plan([], [], act('bB', 0, 2)),
    ));
    expect(r.state.winner).toBe('black');
    const over = r.events.filter((e) => e.kind === 'game-over');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ reason: 'checkmate', subTurn: 4 });
    expect(cancelled(r.events)).toHaveLength(0);
    expect(find(r.state, 'wP')!.pos).toEqual(P(2, 3)); // les coups du roi « maté » ont bien eu lieu
    expect(r.events.some((e) => e.kind === 'check' && e.subTurn === 4)).toBe(false);
  });

  it("un mat qui se défait avant la fin n'est pas un mat", () => {
    // La tour noire donne l'échec au 3e coup, puis repart au 5e : plus de mat à la fin.
    const r = resolvePlans(board(), plans(none, plan([], [], act('bB', 0, 2), [], act('bB', 4, 2))));
    expect(r.state.winner).toBeNull();
    expect(r.events.some((e) => e.kind === 'game-over')).toBe(false);
  });

  it('pat : nulle', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 },
      { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
      { id: 'bA', type: 'R', color: 'black', file: 1, rank: 3 }, // couvre (1,0) (1,1)
      { id: 'bB', type: 'R', color: 'black', file: 4, rank: 1 }, // couvre (0,1)
    ]);
    const r = resolvePlans(s, plans(none));
    expect(r.state.winner).toBe('draw');
    expect(r.events.find((e) => e.kind === 'game-over')).toMatchObject({ reason: 'stalemate' });
  });

  it('deux rois seuls : nulle', () => {
    const r = resolvePlans(createCustomState(kings), plans(none));
    expect(r.state.winner).toBe('draw');
    expect(r.events.find((e) => e.kind === 'game-over')).toMatchObject({ reason: 'insufficient' });
  });

  it("un roi en échec avec une fuite n'est pas mat", () => {
    const s = createCustomState([...kings, { id: 'bR', type: 'R', color: 'black', file: 0, rank: 3 }]);
    expect(resolvePlans(s, plans(none)).state.winner).toBeNull();
  });
});

describe('Game', () => {
  it('une manche complète depuis la position initiale', () => {
    const g = new Game(createInitialState());
    expect(g.submitPlan('white', plan(act('wP2', 2, 2), act('wN0', 4, 2)))).toEqual([]);
    g.submitPlan('black', plan(act('bP2', 2, 2)));
    expect(g.ready).toBe(true);
    g.resolve();
    expect(g.state.sequence).toBe(1);
  });
});
