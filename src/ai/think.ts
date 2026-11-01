import type { ClassicMove } from '../core/classic';
import type { Color, GameState, Plan, RulesConfig } from '../core/types';
import { aiPlan, type Level } from './ai';
import { classicAiMove } from './classicAi';

/**
 * Fait réfléchir l'IA dans un Web Worker (le Grand Maître cherche ~1,2 s : sur le fil principal, la page
 * se figerait). Sans Worker (ancien navigateur, échec de chargement), le calcul se fait sur place.
 */
export type AiRequest =
  | { id: number; kind: 'classic'; state: GameState; color: Color; level: Level }
  | { id: number; kind: 'plan'; state: GameState; color: Color; level: Level; rules: RulesConfig };
export type AiResponse = { id: number; result: ClassicMove | Plan | null };

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, { req: AiRequest; done: (r: unknown) => void }>();

const local = (r: AiRequest): unknown =>
  r.kind === 'classic' ? classicAiMove(r.state, r.color, r.level) : aiPlan(r.state, r.color, r.rules, Math.random, r.level);

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AiResponse>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      p?.done(e.data.result);
    };
    // Le Worker ne démarre pas : on bascule sur le calcul local, y compris pour les demandes en attente.
    worker.onerror = () => {
      worker?.terminate(); worker = null;
      for (const [id, p] of pending) { pending.delete(id); p.done(local(p.req)); }
    };
  } catch {
    worker = null;
  }
  return worker;
}

type Unsent = AiRequest extends infer R ? (R extends AiRequest ? Omit<R, 'id'> : never) : never;

function ask<T>(req: Unsent): Promise<T> {
  const full = { ...req, id: nextId++ } as AiRequest;
  const w = getWorker();
  if (!w) return Promise.resolve(local(full) as T);
  return new Promise<T>((resolve) => {
    pending.set(full.id, { req: full, done: (r) => resolve(r as T) });
    w.postMessage(full);
  });
}

/** Coup de l'IA en mode classique (`null` si aucun coup légal). */
export const thinkClassic = (state: GameState, color: Color, level: Level) =>
  ask<ClassicMove | null>({ kind: 'classic', state, color, level });

/** Plan secret de l'IA en mode Bluff. */
export const thinkPlan = (state: GameState, color: Color, rules: RulesConfig, level: Level) =>
  ask<Plan>({ kind: 'plan', state, color, level, rules });
