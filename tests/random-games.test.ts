import { describe, expect, it } from 'vitest';
import { randomPlan } from '../src/ai/randomAi';
import { createInitialState } from '../src/core/board';
import { resolvePlans } from '../src/core/resolution';

describe('parties IA contre IA', () => {
  it('les rois ne sont jamais capturés et chaque partie se déroule sans erreur', () => {
    for (let g = 0; g < 40; g++) {
      let state = createInitialState();
      for (let seq = 0; seq < 40 && !state.winner; seq++) {
        const res = resolvePlans(state, { white: randomPlan(state, 'white'), black: randomPlan(state, 'black') });
        expect(res.events.filter((e) => e.kind === 'capture' && e.victimId.endsWith('K0'))).toHaveLength(0);
        state = res.state;
        if (!state.winner) {
          expect(state.pieces.filter((p) => p.type === 'K')).toHaveLength(2);
        }
      }
    }
  });
});
