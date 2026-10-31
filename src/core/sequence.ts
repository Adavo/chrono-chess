import { sanitizePlan } from './plan';
import { resolvePlans } from './resolution';
import { DEFAULT_RULES, type Color, type GameEvent, type GameState, type Plan, type RulesConfig } from './types';

export type Phase = 'planning' | 'finished';

/**
 * Machine à états d'une partie. Autoritaire (à exécuter côté hôte) et sans horloge :
 * le timer des 10 s appartient à l'UI/hôte, qui appelle `resolve()` à l'échéance
 * (les joueurs n'ayant rien soumis jouent un plan vide).
 */
export class Game {
  phase: Phase = 'planning';
  private plans: Partial<Record<Color, Plan>> = {};

  constructor(public state: GameState, private rules: RulesConfig = DEFAULT_RULES) {}

  /** Enregistre (ou remplace) le plan secret d'un joueur. Renvoie les avertissements. */
  submitPlan(color: Color, raw: unknown): string[] {
    if (this.phase !== 'planning') return ['not in planning phase'];
    const { plan, errors } = sanitizePlan(this.state, color, raw, this.rules);
    this.plans[color] = plan;
    return errors;
  }

  get ready(): boolean {
    return !!this.plans.white && !!this.plans.black;
  }

  /** Passe en résolution et renvoie les événements à rejouer côté clients. */
  resolve(): GameEvent[] {
    const empty = (): Plan => Array.from({ length: this.rules.subTurns }, () => []);
    const res = resolvePlans(this.state, { white: this.plans.white ?? empty(), black: this.plans.black ?? empty() }, this.rules);
    this.state = res.state;
    this.plans = {};
    this.phase = this.state.winner ? 'finished' : 'planning';
    return res.events;
  }
}
