import { describe, expect, it } from 'vitest';
import { createCustomState, createInitialState } from '../src/core/board';
import { resolvePlans } from '../src/core/resolution';
import { Game } from '../src/core/sequence';

const P = (file: number, rank: number) => ({ file, rank });
const act = (pieceId: string, file: number, rank: number) => [{ pieceId, to: P(file, rank) }];

describe('mats réels depuis la position initiale', () => {
  it('mat du fou : f3 / e5, g4 / Dh4#', () => {
    const r = resolvePlans(createInitialState(), {
      white: [act('wP5', 5, 2), act('wP6', 6, 3), []],
      black: [act('bP4', 4, 4), act('bQ0', 7, 3), []],
    });
    expect(r.events.filter((e) => e.kind === 'cancelled')).toEqual([]);
    expect(r.state.winner).toBe('black');
    expect(r.events.find((e) => e.kind === 'game-over')).toMatchObject({ reason: 'checkmate' });
  });

  it('via la classe Game (chemin utilisé par l\'interface)', () => {
    const g = new Game(createInitialState());
    g.submitPlan('white', [act('wP5', 5, 2), act('wP6', 6, 3), []]);
    g.submitPlan('black', [act('bP4', 4, 4), act('bQ0', 7, 3), []]);
    g.resolve();
    expect(g.state.winner).toBe('black');
    expect(g.phase).toBe('finished');
  });
});

describe('mat du berger', () => {
  it('e4/e5, Fc4/Cc6, Dh5/a6, puis Dxf7#', () => {
    const s0 = createInitialState();
    const r1 = resolvePlans(s0, {
      white: [act('wP4', 4, 3), act('wB1', 2, 3), act('wQ0', 7, 4)],
      black: [act('bP4', 4, 4), act('bN0', 2, 5), act('bP0', 0, 5)],
    });
    expect(r1.events.filter((e) => e.kind === 'cancelled')).toEqual([]);
    expect(r1.state.winner).toBeNull();
    const r2 = resolvePlans(r1.state, { white: [act('wQ0', 5, 6), [], []], black: [[], [], []] });
    expect(r2.events.filter((e) => e.kind === 'cancelled')).toEqual([]);
    expect(r2.state.winner).toBe('white');
  });
});

describe("mat de l'escalier", () => {
  const board = (kingFile: number) => createCustomState([
    { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 },
    { id: 'wA', type: 'R', color: 'white', file: 0, rank: 6 }, // tour a7 : coupe la 7e rangée
    { id: 'wB', type: 'R', color: 'white', file: 1, rank: 0 }, // tour b1 : montera en b8
    { id: 'bK', type: 'K', color: 'black', file: kingFile, rank: 7 },
  ]);

  it.each([7, 4, 3, 6])('roi noir en %i : Tb8#', (kf) => {
    const r = resolvePlans(board(kf), { white: [act('wB', 1, 7), [], []], black: [[], [], []] });
    expect(r.events.filter((e) => e.kind === 'cancelled')).toEqual([]);
    expect(r.state.winner).toBe('white');
  });

  it("l'escalier complet : la tour monte en a7 puis en b8 (le roi ne bouge pas)", () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 4, rank: 0 },
      { id: 'wA', type: 'R', color: 'white', file: 0, rank: 0 },
      { id: 'wB', type: 'R', color: 'white', file: 1, rank: 0 },
      { id: 'bK', type: 'K', color: 'black', file: 4, rank: 7 },
    ]);
    const r = resolvePlans(s, { white: [act('wA', 0, 6), act('wB', 1, 7), []], black: [[], [], []] });
    expect(r.events.filter((e) => e.kind === 'cancelled')).toEqual([]);
    expect(r.state.winner).toBe('white');
  });
});
