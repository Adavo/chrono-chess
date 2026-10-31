import { describe, expect, it } from 'vitest';
import { createCustomState, createInitialState } from '../src/core/board';
import { resolvePlans } from '../src/core/resolution';
import { Game } from '../src/core/sequence';
import type { Color, GameEvent, Plan } from '../src/core/types';

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
    const r = resolvePlans(s, { white: [[...act('wR', 3, 3), ...act('wB', 3, 3)], [], []], black: [[], [], []] }, { ...{ size: 8, subTurns: 3, maxActionsPerSubTurn: 2, collisionValue: { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 } } });
    expect(cancelled(r.events)[0]).toMatchObject({ pieceId: 'wB', reason: 'ally-conflict' });
  });

  it('capture en diagonale du pion annulée si la cible part', () => {
    const s = createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 3, rank: 3 }, { id: 'bN', type: 'N', color: 'black', file: 4, rank: 4 }]);
    const r = resolvePlans(s, plans([act('wP', 4, 4), [], []], [act('bN', 6, 5), [], []]));
    expect(cancelled(r.events)[0]?.reason).toBe('target-moved');
    expect(find(r.state, 'wP')!.pos).toEqual(P(3, 3));
  });
});

describe('fin de partie', () => {
  it('capturer le roi arrête la résolution des sous-tours suivants', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 7, rank: 0 }, { id: 'bR', type: 'R', color: 'black', file: 3, rank: 3 }]);
    const r = resolvePlans(s, plans([act('wR', 7, 7), [], []], [[], act('bR', 3, 4), []]));
    expect(r.state.winner).toBe('white');
    expect(find(r.state, 'bR')!.pos).toEqual(P(3, 3)); // sous-tour 1 jamais joué
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
