import { describe, expect, it } from 'vitest';
import { aiPlan } from '../src/ai/ai';
import { createInitialState } from '../src/core/board';
import { ClassicGame } from '../src/core/classic';
import { replaySteps } from '../src/core/replay';
import { resolvePlans } from '../src/core/resolution';
import { DEFAULT_RULES } from '../src/core/types';
import { norm, rng } from './helpers';

/**
 * L'invité anime la résolution à partir des seuls événements envoyés par l'hôte :
 * le dernier état rejoué doit être exactement l'état final de l'hôte.
 */
describe('replaySteps', () => {
  it('manches de 5 coups', () => {
    const rnd = rng(21);
    for (let i = 0; i < 20; i++) {
      let start = createInitialState();
      for (let seq = 0; seq < 3 && !start.winner; seq++) {
        const res = resolvePlans(start, { white: aiPlan(start, 'white', DEFAULT_RULES, rnd), black: aiPlan(start, 'black', DEFAULT_RULES, rnd) }, DEFAULT_RULES, rnd);
        const steps = replaySteps(start, res.events);
        expect(steps).toHaveLength(5);
        expect(norm(steps.at(-1)!.state)).toEqual(norm(res.state));
        start = res.state;
      }
    }
  });

  it('mode Bluff (un coup) : tout au long de parties complètes', () => {
    const rnd = rng(22);
    const one = { ...DEFAULT_RULES, subTurns: 1 };
    for (let g = 0; g < 6; g++) {
      let start = createInitialState();
      for (let seq = 0; seq < 40 && !start.winner; seq++) {
        const res = resolvePlans(start, { white: aiPlan(start, 'white', one, rnd), black: aiPlan(start, 'black', one, rnd) }, one, rnd);
        const steps = replaySteps(start, res.events);
        expect(steps).toHaveLength(1);
        expect(norm(steps[0]!.state)).toEqual(norm(res.state));
        expect(steps[0]!.state.winner).toBe(res.state.winner);
        start = res.state;
      }
    }
  });

  it('mode classique : chaque coup, promotions comprises', () => {
    const rnd = rng(23);
    let promotions = 0;
    for (let g = 0; g < 20; g++) {
      const game = new ClassicGame(createInitialState());
      for (let ply = 0; ply < 80 && !game.state.winner; ply++) {
        const before = game.state;
        const events = game.play(game.turn, game.randomMove(game.turn, rnd), rnd)!;
        promotions += events.filter((e) => e.kind === 'promotion').length;
        expect(norm(replaySteps(before, events).at(-1)!.state)).toEqual(norm(game.state));
      }
    }
    expect(promotions).toBeGreaterThan(0);
  });
});
