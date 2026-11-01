import { describe, expect, it } from 'vitest';
import { createCustomState, createInitialState } from '../src/core/board';
import { attacksSquare, hasLegalMove, isInCheck, keepsKingSafe, snapshotOf } from '../src/core/check';
import { ClassicGame, legalMoves } from '../src/core/classic';
import { checkMove } from '../src/core/moves';
import type { Color, PieceState, PieceType, Square } from '../src/core/types';
import { rng } from './helpers';

/**
 * Implémentation de référence, volontairement naïve (toutes les cases, toutes les pièces) :
 * le générateur rapide de check.ts doit donner exactement les mêmes résultats.
 */
const naiveInCheck = (pieces: PieceState[], size: number, color: Color) => {
  const king = pieces.find((p) => p.type === 'K' && p.color === color);
  if (!king) return false;
  const snap = snapshotOf(pieces, size);
  return pieces.some((p) => p.color !== color && attacksSquare(snap, p, king.pos));
};
const naiveSafe = (pieces: PieceState[], size: number, mover: PieceState, to: Square) =>
  !naiveInCheck(
    pieces.filter((p) => !(p.color !== mover.color && p.pos.file === to.file && p.pos.rank === to.rank))
      .map((p) => (p.id === mover.id ? { ...p, pos: to } : p)),
    size, mover.color);
const naiveLegal = (pieces: PieceState[], size: number, color: Color) => {
  const snap = snapshotOf(pieces, size);
  const out: string[] = [];
  for (const p of pieces) if (p.color === color) {
    for (let f = 0; f < size; f++) for (let r = 0; r < size; r++) {
      const to = { file: f, rank: r };
      if (!checkMove(snap, p, to, color === 'white' ? 1 : -1).ok || snap.at(to)?.type === 'K') continue;
      if (naiveSafe(pieces, size, p, to)) out.push(`${p.id}>${f},${r}`);
    }
  }
  return out.sort();
};
const fast = (pieces: PieceState[], size: number, color: Color) => legalMoves(pieces, size, color).map((m) => `${m.pieceId}>${m.to.file},${m.to.rank}`).sort();

/** Position aléatoire : deux rois et quelques pièces (dames comprises) sur des cases distinctes. */
function randomPosition(rnd: () => number, size = 5): PieceState[] {
  const free = Array.from({ length: size * size }, (_, i) => i).sort(() => rnd() - 0.5);
  const types: PieceType[] = ['P', 'N', 'B', 'R', 'Q'];
  const pieces = [
    { id: 'wK', type: 'K' as const, color: 'white' as const },
    { id: 'bK', type: 'K' as const, color: 'black' as const },
    ...Array.from({ length: 2 + Math.floor(rnd() * 8) }, (_, i) => ({
      id: `x${i}`, type: types[Math.floor(rnd() * types.length)]!, color: (rnd() < 0.5 ? 'white' : 'black') as Color,
    })),
  ];
  // Cases distinctes ; pas de pion sur une rangée extrême (il aurait déjà été promu, ou ne peut y être).
  const edge = (k: number) => k < size || k >= size * (size - 1);
  return createCustomState(pieces.map((p) => {
    const i = free.findIndex((k) => p.type !== 'P' || !edge(k));
    const sq = free.splice(i, 1)[0]!;
    return { ...p, file: sq % size, rank: Math.floor(sq / size) };
  }), size).pieces;
}

describe('générateur de coups rapide = référence naïve', () => {
  it('positions aléatoires (dames et 6x6 compris)', () => {
    const rnd = rng(7);
    for (let i = 0; i < 1500; i++) {
      const size = i % 5 === 0 ? 6 : 5;
      const pieces = randomPosition(rnd, size);
      for (const color of ['white', 'black'] as const) {
        expect(isInCheck(pieces, size, color)).toBe(naiveInCheck(pieces, size, color));
        expect(fast(pieces, size, color)).toEqual(naiveLegal(pieces, size, color));
        expect(hasLegalMove(pieces, size, color)).toBe(naiveLegal(pieces, size, color).length > 0);
      }
      const mover = pieces[Math.floor(rnd() * pieces.length)]!;
      const to = { file: Math.floor(rnd() * size), rank: Math.floor(rnd() * size) };
      if (!pieces.some((p) => p.color === mover.color && p.pos.file === to.file && p.pos.rank === to.rank)) {
        expect(keepsKingSafe(pieces, size, mover, to)).toBe(naiveSafe(pieces, size, mover, to));
      }
    }
  });

  it('positions issues de vraies parties classiques', () => {
    const rnd = rng(11);
    for (let g = 0; g < 30; g++) {
      const game = new ClassicGame(createInitialState());
      for (let ply = 0; ply < 60 && !game.state.winner; ply++) {
        const { pieces, size } = game.state;
        expect(fast(pieces, size, game.turn)).toEqual(naiveLegal(pieces, size, game.turn));
        game.play(game.turn, game.randomMove(game.turn, rnd), rnd);
      }
    }
  });

  it('les fonctions ne modifient pas les pièces reçues', () => {
    const pieces = randomPosition(rng(3));
    const copy = JSON.stringify(pieces);
    legalMoves(pieces, 5, 'white');
    keepsKingSafe(pieces, 5, pieces[2]!, { file: 0, rank: 0 });
    isInCheck(pieces, 5, 'black');
    expect(JSON.stringify(pieces)).toBe(copy);
  });
});
