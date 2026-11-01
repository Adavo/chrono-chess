import { describe, expect, it } from 'vitest';
import { aiPlan } from '../src/ai/ai';
import { createInitialState } from '../src/core/board';
import { isInCheck } from '../src/core/check';
import { ClassicGame, legalMoves } from '../src/core/classic';
import { resolvePlans } from '../src/core/resolution';
import { DEFAULT_RULES } from '../src/core/types';
import { expectValidState, rng } from './helpers';

describe('parties complètes : chaque position atteinte reste valide', () => {
  it('mode classique, coups au hasard : jamais de roi en échec après son propre coup', () => {
    const rnd = rng(31);
    const reasons = new Set<string>();
    for (let g = 0; g < 60; g++) {
      const game = new ClassicGame(createInitialState());
      for (let ply = 0; ply < 120 && !game.state.winner; ply++) {
        const mover = game.turn;
        const events = game.play(mover, game.randomMove(mover, rnd), rnd);
        expect(events).not.toBeNull();
        expect(game.state.sequence).toBe(ply + 1);
        expectValidState(game.state);
        expect(isInCheck(game.state.pieces, 5, mover)).toBe(false);
        const over = events!.find((e) => e.kind === 'game-over');
        if (over?.kind === 'game-over') reasons.add(over.reason!);
        // partie finie <=> le camp au trait n'a plus de coup (ou il ne reste que les rois)
        if (!game.state.winner) expect(legalMoves(game.state.pieces, 5, game.turn).length).toBeGreaterThan(0);
      }
    }
    expect(reasons.has('checkmate')).toBe(true);
  });

  it('manches de 5 coups, IA contre IA', () => {
    const rnd = rng(32);
    for (let g = 0; g < 10; g++) {
      let state = createInitialState();
      for (let seq = 0; seq < 20 && !state.winner; seq++) {
        state = resolvePlans(state, { white: aiPlan(state, 'white', DEFAULT_RULES, rnd), black: aiPlan(state, 'black', DEFAULT_RULES, rnd) }, DEFAULT_RULES, rnd).state;
        expectValidState(state);
      }
    }
  });
});
