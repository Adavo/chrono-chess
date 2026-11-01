import { describe, expect, it } from 'vitest';
import { aiPlan } from '../src/ai/ai';
import { createInitialState } from '../src/core/board';
import { replaySteps } from '../src/core/replay';
import { resolvePlans } from '../src/core/resolution';

describe('replaySteps', () => {
  it("reconstitue l'état final de la résolution à partir des seuls événements", () => {
    for (let i = 0; i < 20; i++) {
      let start = createInitialState();
      for (let seq = 0; seq < 3 && !start.winner; seq++) {
        const res = resolvePlans(start, { white: aiPlan(start, 'white'), black: aiPlan(start, 'black') });
        const steps = replaySteps(start, res.events);
        expect(steps).toHaveLength(5);
        const last = steps[steps.length - 1]!.state;
        const norm = (s: typeof last) => s.pieces.map((p) => `${p.id}:${p.type}@${p.pos.file},${p.pos.rank}`).sort();
        expect(norm(last)).toEqual(norm(res.state));
        start = res.state;
      }
    }
  });
});
