import { describe, expect, it } from 'vitest';
import { cloneState, createInitialState } from '../src/core/board';
import { buildQueue, sanitizePlan } from '../src/core/plan';
import { Game } from '../src/core/sequence';
import { DEFAULT_RULES } from '../src/core/types';

const P = (file: number, rank: number) => ({ file, rank });
const ONE = { ...DEFAULT_RULES, subTurns: 1 };

describe('sanitizePlan : validation structurelle d\'un plan reçu du réseau', () => {
  const s = createInitialState();

  it('rejette ce qui n\'est pas un tableau', () => {
    for (const raw of [null, undefined, 42, 'plan', { 0: [] }]) {
      const { plan, errors } = sanitizePlan(s, 'white', raw, DEFAULT_RULES);
      expect(plan).toEqual([[], [], [], [], []]);
      expect(errors).toHaveLength(1);
    }
  });

  it('écarte les pièces adverses ou inconnues et les cases hors plateau', () => {
    const raw = [
      [{ pieceId: 'bP0', to: P(0, 2) }],
      [{ pieceId: 'zz', to: P(0, 2) }],
      [{ pieceId: 'wP0', to: P(0, 9) }],
      [{ pieceId: 'wP0', to: P(0.5, 2) }],
      [{ pieceId: 'wP0', to: P(0, 2) }],
    ];
    const { plan, errors } = sanitizePlan(s, 'white', raw, DEFAULT_RULES);
    expect(plan).toEqual([[], [], [], [], [{ pieceId: 'wP0', to: P(0, 2) }]]);
    expect(errors).toHaveLength(4);
  });

  it('tronque au nombre de sous-tours et d\'actions permis', () => {
    const many = Array.from({ length: 9 }, () => [{ pieceId: 'wP0', to: P(0, 2) }, { pieceId: 'wP1', to: P(1, 2) }]);
    const { plan } = sanitizePlan(s, 'white', many, ONE);
    expect(plan).toEqual([[{ pieceId: 'wP0', to: P(0, 2) }]]);
  });

  it('garde une promotion valide, ignore les autres, et retire les champs inconnus', () => {
    const raw = [[{ pieceId: 'wP0', to: P(0, 2), promo: 'B', hack: 1 }], [{ pieceId: 'wP1', to: P(1, 2), promo: 'Q' }]];
    const { plan } = sanitizePlan(s, 'white', raw, DEFAULT_RULES);
    expect(plan[0]).toEqual([{ pieceId: 'wP0', to: P(0, 2), promo: 'B' }]);
    expect(plan[1]).toEqual([{ pieceId: 'wP1', to: P(1, 2) }]);
  });
});

describe('buildQueue', () => {
  it('trie par sous-tour, puis blancs avant noirs, puis ordre de soumission', () => {
    const q = buildQueue({
      white: [[], [{ pieceId: 'w1', to: P(0, 0) }]],
      black: [[{ pieceId: 'b0', to: P(0, 0) }], [{ pieceId: 'b1', to: P(0, 0) }]],
    });
    expect(q.map((a) => `${a.subTurn}${a.owner[0]}${a.pieceId}`)).toEqual(['0bb0', '1ww1', '1bb1']);
  });
});

describe('Game (mode Bluff)', () => {
  it('attend les deux plans ; un plan manquant compte comme vide', () => {
    const g = new Game(createInitialState(), ONE);
    expect(g.ready).toBe(false);
    g.submitPlan('white', [[{ pieceId: 'wP2', to: P(2, 2) }]]);
    expect(g.ready).toBe(false);
    const events = g.resolve();
    expect(events.filter((e) => e.kind === 'move')).toHaveLength(1);
    expect(g.state.sequence).toBe(1);
    expect(g.phase).toBe('planning');
  });

  it('un plan soumis à nouveau remplace le précédent', () => {
    const g = new Game(createInitialState(), ONE);
    g.submitPlan('white', [[{ pieceId: 'wP0', to: P(0, 2) }]]);
    g.submitPlan('white', [[{ pieceId: 'wP4', to: P(4, 2) }]]);
    g.submitPlan('black', []);
    expect(g.ready).toBe(true);
    g.resolve();
    expect(g.state.pieces.find((p) => p.id === 'wP4')!.pos).toEqual(P(4, 2));
    expect(g.state.pieces.find((p) => p.id === 'wP0')!.pos).toEqual(P(0, 1));
  });
});

describe('cloneState', () => {
  it('copie profonde : modifier la copie ne touche pas l\'original', () => {
    const s = createInitialState();
    const c = cloneState(s);
    c.pieces[0]!.pos = P(3, 3);
    c.pieces[1]!.type = 'Q';
    c.grid[0] = null;
    expect(s).toEqual(createInitialState());
    expect(c).not.toEqual(s);
  });
});
