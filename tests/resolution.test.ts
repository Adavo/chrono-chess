import { describe, expect, it } from 'vitest';
import { createCustomState, createInitialState } from '../src/core/board';
import { resolvePlans } from '../src/core/resolution';
import { Game } from '../src/core/sequence';
import { DEFAULT_RULES, type Color, type GameEvent, type Plan } from '../src/core/types';

const P = (file: number, rank: number) => ({ file, rank });
const act = (pieceId: string, file: number, rank: number) => [{ pieceId, to: P(file, rank) }];
const plans = (white: Plan, black: Plan): Record<Color, Plan> => ({ white, black });
const cancelled = (ev: GameEvent[]) => ev.filter((e) => e.kind === 'cancelled') as Extract<GameEvent, { kind: 'cancelled' }>[];
const kings = [
  { id: 'wK', type: 'K' as const, color: 'white' as const, file: 0, rank: 0 },
  { id: 'bK', type: 'K' as const, color: 'black' as const, file: 7, rank: 7 },
];
const find = (s: ReturnType<typeof createCustomState>, id: string) => s.pieces.find((p) => p.id === id);

describe('coups caducs (option 1)', () => {
  it("annule l'action d'une pièce capturée au sous-tour précédent, sans correctif", () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 3, rank: 3 }, { id: 'bR', type: 'R', color: 'black', file: 3, rank: 6 }]);
    const r = resolvePlans(s, plans([act('wR', 3, 6), [], []], [[], [], act('bR', 3, 0)]));
    // bR est capturée au sous-tour 0 : son action du sous-tour 2 est caduque
    expect(find(r.state, 'bR')).toBeUndefined();
    expect(cancelled(r.events)).toMatchObject([{ pieceId: 'bR', reason: 'piece-not-found', owner: 'black' }]);
  });

  it("n'exécute pas un coup bloqué et ne le corrige pas", () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 3 }, { id: 'wP', type: 'P', color: 'white', file: 4, rank: 3 }]);
    const r = resolvePlans(s, plans([act('wR', 7, 3), [], []], [[], [], []]));
    expect(cancelled(r.events)[0]?.reason).toBe('path-blocked');
    expect(find(r.state, 'wR')!.pos).toEqual(P(0, 3));
  });

  it('évalue les actions suivantes depuis la position réelle', () => {
    // wR devait aller en (3,3) puis (3,6) ; le 1er coup est bloqué, le 2e (en ligne droite
    // depuis (0,3)) est donc géométriquement impossible.
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 3 }, { id: 'bP', type: 'P', color: 'black', file: 1, rank: 3 }]);
    const r = resolvePlans(s, plans([act('wR', 3, 3), act('wR', 3, 6), []], [[], [], []]));
    expect(cancelled(r.events).map((c) => c.reason)).toEqual(['path-blocked', 'illegal-geometry']);
    expect(find(r.state, 'wR')!.pos).toEqual(P(0, 3));
  });
});

describe('collisions', () => {
  it('le mouvant capture une pièce ennemie immobile', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 3 }, { id: 'bN', type: 'N', color: 'black', file: 5, rank: 3 }]);
    const r = resolvePlans(s, plans([act('wR', 5, 3), [], []], [[], [], []]));
    expect(find(r.state, 'bN')).toBeUndefined();
    expect(find(r.state, 'wR')!.pos).toEqual(P(5, 3));
  });

  it('arrivée simultanée : la plus forte valeur gagne', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 3 }, { id: 'bN', type: 'N', color: 'black', file: 5, rank: 5 }]);
    const r = resolvePlans(s, plans([act('wR', 4, 3), [], []], [act('bN', 4, 3), [], []]));
    expect(find(r.state, 'bN')).toBeUndefined();
    expect(find(r.state, 'wR')!.pos).toEqual(P(4, 3));
  });

  it('égalité de valeur : destruction mutuelle', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 3 }, { id: 'bR', type: 'R', color: 'black', file: 4, rank: 7 }]);
    const r = resolvePlans(s, plans([act('wR', 4, 3), [], []], [act('bR', 4, 3), [], []]));
    expect(find(r.state, 'wR')).toBeUndefined();
    expect(find(r.state, 'bR')).toBeUndefined();
  });

  it('un échange de cases est permis (chacun quitte sa case)', () => {
    const s = createCustomState([...kings, { id: 'wN', type: 'N', color: 'white', file: 3, rank: 3 }, { id: 'bN', type: 'N', color: 'black', file: 4, rank: 5 }]);
    const r = resolvePlans(s, plans([act('wN', 4, 5), [], []], [act('bN', 3, 3), [], []]));
    expect(find(r.state, 'wN')!.pos).toEqual(P(4, 5));
    expect(find(r.state, 'bN')!.pos).toEqual(P(3, 3));
  });

  it('deux alliés sur la même case : le second est caduc', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 3 }, { id: 'wB', type: 'B', color: 'white', file: 1, rank: 1 }]);
    const r = resolvePlans(s, { white: [[...act('wR', 3, 3), ...act('wB', 3, 3)], [], []], black: [[], [], []] }, { ...DEFAULT_RULES, maxActionsPerSubTurn: 2 });
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wB', reason: 'ally-conflict' });
  });

  it('capture en diagonale du pion annulée si la cible part', () => {
    const s = createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 3, rank: 3 }, { id: 'bN', type: 'N', color: 'black', file: 4, rank: 4 }]);
    const r = resolvePlans(s, plans([act('wP', 4, 4), [], []], [act('bN', 6, 5), [], []]));
    expect(cancelled(r.events)[0]?.reason).toBe('target-moved');
    expect(find(r.state, 'wP')!.pos).toEqual(P(3, 3));
  });
});

describe("règle d'échec", () => {
  // Roi blanc en e1 attaqué par la tour noire en e8 (colonne e).
  const inCheckBoard = () => createCustomState([
    { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 },
    { id: 'bK', type: 'K', color: 'black', file: 0, rank: 7 },
    { id: 'bR', type: 'R', color: 'black', file: 4, rank: 7 },
    { id: 'wR', type: 'R', color: 'white', file: 0, rank: 3 },
    { id: 'wN', type: 'N', color: 'white', file: 6, rank: 0 },
  ]);

  it("annule un coup qui ne résout pas l'échec", () => {
    const r = resolvePlans(inCheckBoard(), plans([act('wR', 0, 4), [], []], [[], [], []]));
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wR', reason: 'king-in-check' });
    expect(find(r.state, 'wR')!.pos).toEqual(P(0, 3));
  });

  it("accepte l'interposition, la fuite et la capture de l'attaquant", () => {
    const block = resolvePlans(inCheckBoard(), plans([act('wR', 4, 3), [], []], [[], [], []]));
    expect(cancelled(block.events)).toHaveLength(0);
    const flee = resolvePlans(inCheckBoard(), plans([act('wK', 3, 0), [], []], [[], [], []]));
    expect(cancelled(flee.events)).toHaveLength(0);
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 7 },
      { id: 'bR', type: 'R', color: 'black', file: 4, rank: 7 }, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 7 },
    ]);
    const take = resolvePlans(s, plans([act('wR', 4, 7), [], []], [[], [], []]));
    expect(find(take.state, 'bR')).toBeUndefined();
  });

  it("refuse de rester dans la ligne de l'attaquant", () => {
    const r = resolvePlans(inCheckBoard(), plans([act('wK', 4, 1), [], []], [[], [], []]));
    expect(cancelled(r.events)[0]?.reason).toBe('king-in-check');
  });

  it("un roi ne peut pas aller sur une case attaquée par un cavalier", () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 7 },
      { id: 'bN', type: 'N', color: 'black', file: 5, rank: 3 }, // f4 : attaque notamment e2 et g2
    ]);
    const r = resolvePlans(s, plans([act('wK', 4, 1), [], []], [[], [], []])); // e2 : attaquée par le cavalier f4
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wK', reason: 'king-in-check' });
    expect(find(r.state, 'wK')!.pos).toEqual(P(4, 0));
    const ok = resolvePlans(s, plans([act('wK', 5, 0), [], []], [[], [], []])); // f1 : sûre
    expect(cancelled(ok.events)).toHaveLength(0);
  });

  it('une pièce clouée ne peut pas quitter la ligne du roi', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 7 },
      { id: 'bR', type: 'R', color: 'black', file: 4, rank: 7 }, { id: 'wR', type: 'R', color: 'white', file: 4, rank: 3 },
    ]);
    const r = resolvePlans(s, plans([act('wR', 0, 3), [], []], [[], [], []]));
    expect(cancelled(r.events)[0]?.reason).toBe('king-in-check');
  });

  it("règle légère (strictKingSafety: false) : hors échec, tout coup est permis", () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 7 },
      { id: 'bR', type: 'R', color: 'black', file: 4, rank: 7 }, { id: 'wP', type: 'P', color: 'white', file: 4, rank: 3 },
    ]);
    // le pion e4 clouait la tour ; il part : le roi se retrouve exposé mais le coup est autorisé
    const r = resolvePlans(s, plans([act('wP', 4, 4), [], []], [[], [], []]), { ...DEFAULT_RULES, strictKingSafety: false });
    expect(cancelled(r.events)).toHaveLength(0);
  });

  it('la même pièce peut jouer à chaque sous-tour', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 3 }]);
    const r = resolvePlans(s, plans([act('wR', 3, 3), act('wR', 3, 5), act('wR', 6, 5)], [[], [], []]));
    expect(cancelled(r.events)).toHaveLength(0);
    expect(find(r.state, 'wR')!.pos).toEqual(P(6, 5));
  });
});

describe('fin de partie (règles classiques)', () => {
  it('un roi ne peut pas être capturé', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 7, rank: 7 },
      { id: 'wR', type: 'R', color: 'white', file: 7, rank: 0 }, { id: 'bP', type: 'P', color: 'black', file: 0, rank: 6 },
    ]);
    const r = resolvePlans(s, plans([act('wR', 7, 7), [], []], [[], [], []]));
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wR', reason: 'king-capture' });
    expect(find(r.state, 'bK')).toBeDefined();
    expect(r.state.winner).toBeNull();
  });

  it('échec et mat : le joueur maté perd et les sous-tours suivants sont ignorés', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 }, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 0 },
      { id: 'bK', type: 'K', color: 'black', file: 7, rank: 7 }, { id: 'bG', type: 'P', color: 'black', file: 6, rank: 6 },
      { id: 'bH', type: 'P', color: 'black', file: 7, rank: 6 }, { id: 'bA', type: 'P', color: 'black', file: 1, rank: 6 },
    ]);
    const r = resolvePlans(s, plans([act('wR', 0, 7), [], []], [[], act('bA', 1, 5), []]));
    expect(r.state.winner).toBe('white');
    expect(r.events.find((e) => e.kind === 'game-over')).toMatchObject({ reason: 'checkmate' });
    expect(find(r.state, 'bA')!.pos).toEqual(P(1, 6)); // sous-tour 1 jamais joué
  });

  it('pat : nulle', () => {
    const s = createCustomState([
      { id: 'bK', type: 'K', color: 'black', file: 0, rank: 7 }, { id: 'wK', type: 'K', color: 'white', file: 2, rank: 5 },
      { id: 'wQ', type: 'Q', color: 'white', file: 1, rank: 3 },
    ]);
    const r = resolvePlans(s, plans([act('wQ', 1, 5), [], []], [[], [], []]));
    expect(r.state.winner).toBe('draw');
    expect(r.events.find((e) => e.kind === 'game-over')).toMatchObject({ reason: 'stalemate' });
  });

  it("un roi en échec mais avec une parade n'est pas mat", () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 }, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 0 },
      { id: 'bK', type: 'K', color: 'black', file: 7, rank: 7 },
    ]);
    const r = resolvePlans(s, plans([act('wR', 0, 7), [], []], [[], [], []]));
    expect(r.state.winner).toBeNull(); // le roi noir peut fuir en h7 / g7
  });
});

describe('Game', () => {
  it('une Séquence complète depuis la position initiale', () => {
    const g = new Game(createInitialState());
    expect(g.submitPlan('white', [act('wP4', 4, 3), act('wN1', 5, 2), []])).toEqual([]);
    g.submitPlan('black', [act('bP4', 4, 4), [], []]);
    expect(g.ready).toBe(true);
    g.resolve();
    expect(g.state.sequence).toBe(1);
    expect(find(g.state, 'wP4')!.pos).toEqual(P(4, 3));
  });
});
