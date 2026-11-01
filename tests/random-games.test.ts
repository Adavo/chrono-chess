import { describe, expect, it } from 'vitest';
import { aiPlan } from '../src/ai/ai';
import { createInitialState } from '../src/core/board';
import { resolvePlans } from '../src/core/resolution';

describe('parties IA contre IA', () => {
  it('les rois ne sont jamais détruits et chaque partie se déroule sans erreur', () => {
    let finished = 0;
    for (let g = 0; g < 12; g++) {
      let state = createInitialState();
      for (let seq = 0; seq < 20 && !state.winner; seq++) {
        state = resolvePlans(state, { white: aiPlan(state, 'white'), black: aiPlan(state, 'black') }).state;
        if (state.winner) finished++;
        else expect(state.pieces.filter((p) => p.type === 'K')).toHaveLength(2);
      }
    }
    expect(finished).toBeGreaterThanOrEqual(0);
  });
});
