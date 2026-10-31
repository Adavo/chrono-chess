import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/board';
import { randomPlan } from '../src/ai/randomAi';
import { replaySteps } from '../src/core/replay';
import { resolvePlans } from '../src/core/resolution';

describe('replaySteps', () => {
  it("reconstitue l'état final de la résolution à partir des seuls événements", () => {
    for (let i = 0; i < 50; i++) {
      const start = createInitialState();
      const res = resolvePlans(start, { white: randomPlan(start, 'white'), black: randomPlan(start, 'black') });
      const steps = replaySteps(start, res.events);
      const last = steps[steps.length - 1]!.state;
      const norm = (s: typeof last) => s.pieces.map((p) => `${p.id}:${p.type}@${p.pos.file},${p.pos.rank}`).sort();
      expect(norm(last)).toEqual(norm(res.state));
    }
  });
});
