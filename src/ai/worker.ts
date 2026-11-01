import { aiPlan } from './ai';
import { classicAiMove } from './classicAi';
import type { AiRequest, AiResponse } from './think';

/** Réflexion de l'IA hors du fil principal : le chrono et les animations restent fluides. */
// Le projet est typé avec la lib DOM : on décrit juste ce dont on a besoin de la portée du Worker.
const scope = self as unknown as { onmessage: (e: MessageEvent<AiRequest>) => void; postMessage: (m: AiResponse) => void };
scope.onmessage = (e) => {
  const r = e.data;
  const result = r.kind === 'classic'
    ? classicAiMove(r.state, r.color, r.level)
    : aiPlan(r.state, r.color, r.rules, Math.random, r.level);
  scope.postMessage({ id: r.id, result });
};
