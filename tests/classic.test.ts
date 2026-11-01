import { describe, expect, it } from 'vitest';
import { createCustomState, createInitialState } from '../src/core/board';
import { ClassicGame, classicOutcome, legalMoves, turnOf } from '../src/core/classic';
import { DEFAULT_RULES } from '../src/core/types';
import { resolvePlans } from '../src/core/resolution';

const P = (file: number, rank: number) => ({ file, rank });
type Piece = Parameters<typeof createCustomState>[0][number];
const kings: Piece[] = [
  { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 },
  { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
];

describe('mode classique : coups légaux', () => {
  it('depuis la position de départ : 5 pas de pion et 2 coups de cavalier', () => {
    const s = createInitialState();
    expect(legalMoves(s.pieces, 5, 'white')).toHaveLength(7);
    expect(legalMoves(s.pieces, 5, 'black')).toHaveLength(7);
  });

  it('les trajectoires sont bloquées par toute pièce', () => {
    const s = createCustomState([...kings, { id: 'wR', type: 'R', color: 'white', file: 0, rank: 2 }, { id: 'bP', type: 'P', color: 'black', file: 2, rank: 2 }]);
    const targets = legalMoves(s.pieces, 5, 'white').filter((m) => m.pieceId === 'wR').map((m) => `${m.to.file},${m.to.rank}`);
    expect(targets).toContain('2,2'); // capture du pion
    expect(targets).not.toContain('3,2'); // derrière le pion
  });

  it("aucun coup ne laisse ou ne met le roi en échec, même pour une pièce clouée", () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 2, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 4 },
      { id: 'bR', type: 'R', color: 'black', file: 2, rank: 4 }, { id: 'wR', type: 'R', color: 'white', file: 2, rank: 2 },
    ]);
    const wr = legalMoves(s.pieces, 5, 'white').filter((m) => m.pieceId === 'wR').map((m) => `${m.to.file},${m.to.rank}`);
    expect(wr.every((t) => t.startsWith('2,'))).toBe(true); // la tour clouée reste sur la colonne du roi
  });
});

describe('ClassicGame', () => {
  it('les blancs commencent, on joue à tour de rôle, un coup illégal ou hors tour est refusé', () => {
    const g = new ClassicGame(createInitialState());
    expect(g.turn).toBe('white');
    expect(g.play('black', { pieceId: 'bP2', to: P(2, 2) })).toBeNull(); // pas son tour
    expect(g.play('white', { pieceId: 'wR0', to: P(0, 2) })).toBeNull(); // trajectoire bloquée par son pion
    const ev = g.play('white', { pieceId: 'wP2', to: P(2, 2) });
    expect(ev).not.toBeNull();
    expect(g.state.sequence).toBe(1);
    expect(g.turn).toBe('black');
    expect(turnOf(g.state)).toBe('black');
    expect(g.play('white', { pieceId: 'wP1', to: P(1, 2) })).toBeNull();
  });

  it("une capture classique : la pièce qui bouge l'emporte, quelle que soit sa force", () => {
    const g = new ClassicGame(createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 1, rank: 2 }, { id: 'bR', type: 'R', color: 'black', file: 2, rank: 3 }]));
    g.play('white', { pieceId: 'wP', to: P(2, 3) });
    expect(g.state.pieces.find((p) => p.id === 'bR')).toBeUndefined();
    expect(g.state.pieces.find((p) => p.id === 'wP')!.pos).toEqual(P(2, 3));
  });

  it('échec et mat : la partie est jugée tout de suite', () => {
    // Noirs à jouer : Tour b -> a3 donne mat au roi blanc en a1 (l'autre tour couvre la colonne b).
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 0, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 4, rank: 4 },
      { id: 'bA', type: 'R', color: 'black', file: 1, rank: 3 }, { id: 'bB', type: 'R', color: 'black', file: 3, rank: 2 },
    ]);
    s.sequence = 1;
    const g = new ClassicGame(s);
    const ev = g.play('black', { pieceId: 'bB', to: P(0, 2) });
    expect(g.state.winner).toBe('black');
    expect(ev!.find((e) => e.kind === 'game-over')).toMatchObject({ reason: 'checkmate' });
    expect(g.play('white', { pieceId: 'wK', to: P(0, 1) })).toBeNull();
  });

  it('pat et deux rois seuls : nulle', () => {
    const stale = createCustomState([
      ...kings,
      { id: 'bA', type: 'R', color: 'black', file: 1, rank: 3 }, { id: 'bB', type: 'R', color: 'black', file: 4, rank: 1 },
    ]);
    expect(classicOutcome(stale.pieces, 5, 'white')).toMatchObject({ winner: 'draw', reason: 'stalemate' });
    expect(classicOutcome(createCustomState(kings).pieces, 5, 'white')).toMatchObject({ winner: 'draw', reason: 'insufficient' });
  });

  it('un roi en échec doit le parer ; la promotion demandée est respectée', () => {
    const s = createCustomState([
      { id: 'wK', type: 'K', color: 'white', file: 2, rank: 0 }, { id: 'bK', type: 'K', color: 'black', file: 0, rank: 4 },
      { id: 'bR', type: 'R', color: 'black', file: 2, rank: 3 }, { id: 'wP', type: 'P', color: 'white', file: 4, rank: 3 },
    ]);
    const g = new ClassicGame(s);
    expect(g.play('white', { pieceId: 'wP', to: P(4, 4) })).toBeNull(); // ne pare pas l'échec
    const s2 = createCustomState([...kings, { id: 'wP', type: 'P', color: 'white', file: 2, rank: 3 }]);
    const g2 = new ClassicGame(s2);
    g2.play('white', { pieceId: 'wP', to: P(2, 4), promo: 'B' });
    expect(g2.state.pieces.find((p) => p.id === 'wP')!.type).toBe('B');
  });
});

describe('mode B : un seul coup simultané', () => {
  it('résolu comme les autres modes, avec subTurns = 1', () => {
    const rules = { ...DEFAULT_RULES, subTurns: 1 };
    const s = createInitialState();
    const r = resolvePlans(s, { white: [[{ pieceId: 'wP2', to: P(2, 2) }]], black: [[{ pieceId: 'bP2', to: P(2, 2) }]] }, rules);
    expect(r.events.filter((e) => e.kind === 'sub-turn-start')).toHaveLength(1);
    expect(r.state.sequence).toBe(1);
    // arrivée simultanée de deux pions sur la même case : ils s'annulent
    expect(r.state.pieces.find((p) => p.id === 'wP2')).toBeUndefined();
    expect(r.state.pieces.find((p) => p.id === 'bP2')).toBeUndefined();
  });
});
