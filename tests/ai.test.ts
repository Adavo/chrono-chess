import { describe, expect, it } from 'vitest';
import { aiPlan, LEVELS } from '../src/ai/ai';
import { classicAiMove } from '../src/ai/classicAi';
import { createCustomState, createInitialState, sameSquare } from '../src/core/board';
import { ClassicGame, legalMoves } from '../src/core/classic';
import { resolvePlans } from '../src/core/resolution';
import { DEFAULT_RULES, type Color } from '../src/core/types';
import { expectValidState, rng } from './helpers';

const P = (file: number, rank: number) => ({ file, rank });
const ONE = { ...DEFAULT_RULES, subTurns: 1 };
const isLegal = (state: ReturnType<typeof createInitialState>, color: Color, m: { pieceId: string; to: { file: number; rank: number } } | null) =>
  !!m && legalMoves(state.pieces, state.size, color).some((l) => l.pieceId === m.pieceId && sameSquare(l.to, m.to));

describe('IA du mode classique', () => {
  it('chaque niveau joue toujours un coup légal', () => {
    const rnd = rng(5);
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const g = new ClassicGame(createInitialState());
      for (let ply = 0; ply < 40 && !g.state.winner; ply++) {
        const m = classicAiMove(g.state, g.turn, level, rnd);
        expect(isLegal(g.state, g.turn, m)).toBe(true);
        expect(g.play(g.turn, m, rnd)).not.toBeNull();
      }
    }
  });

  it('aucun coup légal : null', () => {
    // Roi blanc pat dans le coin.
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
      { id: 'bA', type: 'R', color: 'black', file: 1, rank: 3 }, { id: 'bB', type: 'R', color: 'black', file: 4, rank: 1 },
    ]);
    expect(classicAiMove(s, 'white', 'master')).toBeNull();
  });

  it('difficile et Grand Maître voient le mat en un coup', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
      { id: 'bA', type: 'R', color: 'black', file: 1, rank: 3 }, { id: 'bB', type: 'R', color: 'black', file: 3, rank: 2 },
    ]);
    for (const level of ['hard', 'master'] as const) {
      const m = classicAiMove(s, 'black', level, rng(1))!;
      const g = new ClassicGame({ ...s, sequence: 1 });
      g.play('black', m);
      expect(g.state.winner).toBe('black');
    }
  });

  it('moyen et au-dessus prennent une tour offerte', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
      { id: 'wN', type: 'N', color: 'white', file: 1, rank: 1 }, { id: 'bR', type: 'R', color: 'black', file: 2, rank: 3 },
    ]);
    for (const level of ['medium', 'hard', 'master'] as const) {
      expect(classicAiMove(s, 'white', level, rng(2))).toEqual({ pieceId: 'wN', to: P(2, 3) });
    }
  });

  it('difficile ne laisse pas sa dame en prise contre un pion', () => {
    // La dame blanche en c2 peut aller en b3 (prise par le pion a4) ou ailleurs : elle ne doit pas s'y offrir.
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
      { id: 'wQ', type: 'Q', color: 'white', file: 2, rank: 1 }, { id: 'bP', type: 'P', color: 'black', file: 0, rank: 3 },
    ]);
    for (let i = 0; i < 10; i++) expect(classicAiMove(s, 'white', 'hard', rng(i + 1))!.to).not.toEqual(P(1, 2));
  });
});

describe('IA du mode Bluff', () => {
  it('un plan d\'un seul coup, avec ses propres pièces, à chaque niveau', () => {
    const s = createInitialState();
    for (const level of LEVELS) {
      for (const color of ['white', 'black'] as const) {
        const plan = aiPlan(s, color, ONE, rng(3), level);
        expect(plan).toHaveLength(1);
        expect(plan[0]!.length).toBeLessThanOrEqual(1);
        for (const a of plan[0]!) expect(s.pieces.find((p) => p.id === a.pieceId)?.color).toBe(color);
      }
    }
  });

  it('joue toujours un coup quand elle en a un, même au niveau facile', () => {
    for (const level of LEVELS) {
      for (let i = 0; i < 40; i++) expect(aiPlan(createInitialState(), 'black', ONE, rng(i + 1), level)[0]).toHaveLength(1);
    }
  });

  it('IA contre IA : parties complètes sans position invalide', () => {
    const rnd = rng(13);
    let finished = 0;
    for (let g = 0; g < 8; g++) {
      let state = createInitialState();
      const levels = [LEVELS[g % 4]!, LEVELS[(g + 1) % 4]!];
      for (let seq = 0; seq < 60 && !state.winner; seq++) {
        const plans = { white: aiPlan(state, 'white', ONE, rnd, levels[0]), black: aiPlan(state, 'black', ONE, rnd, levels[1]) };
        state = resolvePlans(state, plans, ONE, rnd).state;
        expect(state.sequence).toBe(seq + 1);
        expectValidState(state);
      }
      if (state.winner) finished++;
    }
    expect(finished).toBeGreaterThan(0);
  }, 60000);

  it('le Grand Maître prend une tour offerte quand rien ne la protège', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
      { id: 'wR', type: 'R', color: 'white', file: 1, rank: 1 }, { id: 'bR', type: 'R', color: 'black', file: 1, rank: 3 },
    ]);
    // Les deux tours se menacent : le premier qui prend gagne la pièce si l'autre ne fuit pas.
    expect(aiPlan(s, 'white', ONE, rng(4), 'master')[0]).toEqual([{ pieceId: 'wR', to: P(1, 3) }]);
  });
});
