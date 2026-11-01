import { expect } from 'vitest';
import { sqKey } from '../src/core/board';
import type { GameState } from '../src/core/types';

/** Générateur pseudo-aléatoire déterministe (Park-Miller) : tests reproductibles. */
export function rng(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Invariants de toute position atteinte en jeu : une pièce par case, cache `grid` à jour,
 * aucun pion sur sa rangée de promotion, un roi par camp tant que la partie n'est pas jugée.
 */
export function expectValidState(s: GameState): void {
  const keys = s.pieces.map((p) => sqKey(p.pos, s.size));
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(s.pieces.map((p) => p.id)).size).toBe(s.pieces.length);
  const grid = new Array(s.size * s.size).fill(null);
  for (const p of s.pieces) grid[sqKey(p.pos, s.size)] = p.id;
  expect(s.grid).toEqual(grid);
  for (const p of s.pieces) {
    if (p.type === 'P') expect(p.pos.rank).not.toBe(p.color === 'white' ? s.size - 1 : 0);
  }
  for (const c of ['white', 'black'] as const) {
    expect(s.pieces.filter((p) => p.type === 'K' && p.color === c)).toHaveLength(1);
  }
}

/** Forme normalisée des pièces, pour comparer deux états sans dépendre de l'ordre. */
export const norm = (s: GameState) => s.pieces.map((p) => `${p.id}:${p.type}@${p.pos.file},${p.pos.rank}`).sort();
