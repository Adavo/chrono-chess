import { inBounds } from './board';
import type { ActionQueue, Color, GameState, Plan, RulesConfig } from './types';

/**
 * Normalise un plan reçu d'un client (validation STRUCTURELLE uniquement).
 * On ne vérifie volontairement PAS la légalité des coups : elle dépend de l'état
 * futur du plateau et n'est jugée qu'au moment de l'exécution (coups caducs).
 */
export function sanitizePlan(
  state: GameState,
  color: Color,
  raw: unknown,
  rules: RulesConfig,
): { plan: Plan; errors: string[] } {
  const errors: string[] = [];
  const plan: Plan = Array.from({ length: rules.subTurns }, () => []);
  if (!Array.isArray(raw)) return { plan, errors: ['plan is not an array'] };

  const ownIds = new Set(state.pieces.filter((p) => p.color === color).map((p) => p.id));
  raw.slice(0, rules.subTurns).forEach((actions, t) => {
    if (!Array.isArray(actions)) return void errors.push(`sub-turn ${t}: not an array`);
    for (const a of actions.slice(0, rules.maxActionsPerSubTurn)) {
      const ok =
        a && typeof a.pieceId === 'string' && ownIds.has(a.pieceId) && a.to && inBounds(a.to, state.size);
      if (ok) plan[t]!.push({ pieceId: a.pieceId, to: { file: a.to.file, rank: a.to.rank } });
      else errors.push(`sub-turn ${t}: invalid action dropped`);
    }
  });
  return { plan, errors };
}

/** Fusionne les deux plans en une file unique triée (sous-tour, joueur, ordre de soumission). */
export function buildQueue(plans: Record<Color, Plan>): ActionQueue {
  const queue: ActionQueue = [];
  for (const owner of ['white', 'black'] as const) {
    plans[owner].forEach((actions, subTurn) =>
      actions.forEach((a, order) => queue.push({ ...a, subTurn, owner, order })),
    );
  }
  const ownerRank = { white: 0, black: 1 };
  return queue.sort((a, b) => a.subTurn - b.subTurn || ownerRank[a.owner] - ownerRank[b.owner] || a.order - b.order);
}
