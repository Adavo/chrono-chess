import { DEFAULT_RULES, type Color, type GameState, type PieceState, type PieceType, type Square } from './types';

export const sqKey = (s: Square, size: number): number => s.rank * size + s.file;
export const inBounds = (s: Square, size: number): boolean =>
  Number.isInteger(s.file) && Number.isInteger(s.rank) && s.file >= 0 && s.file < size && s.rank >= 0 && s.rank < size;
export const sameSquare = (a: Square, b: Square): boolean => a.file === b.file && a.rank === b.rank;

/** Reconstruit le cache `grid` depuis `pieces` (source de vérité). */
export function rebuildGrid(state: GameState): void {
  state.grid = new Array<string | null>(state.size * state.size).fill(null);
  for (const p of state.pieces) state.grid[sqKey(p.pos, state.size)] = p.id;
}

/** Construit un état à partir d'une liste de pièces (tests, scénarios, puzzles). */
export function createCustomState(
  pieces: Array<{ id: string; type: PieceType; color: Color; file: number; rank: number }>,
  size = DEFAULT_RULES.size,
): GameState {
  const state: GameState = {
    size,
    pieces: pieces.map((p) => ({ id: p.id, type: p.type, color: p.color, pos: { file: p.file, rank: p.rank } })),
    grid: [],
    sequence: 0,
    winner: null,
  };
  rebuildGrid(state);
  return state;
}

/**
 * Position de départ 5x5 : Tour, Fou, Roi, Cavalier, Tour sur la dernière rangée,
 * cinq pions devant. Les noirs sont placés dans les mêmes colonnes (face à face).
 */
export function createInitialState(): GameState {
  const size = DEFAULT_RULES.size;
  const back: PieceType[] = ['R', 'B', 'K', 'N', 'R'];
  const pieces: PieceState[] = [];
  const counters: Record<string, number> = {};
  const add = (type: PieceType, color: Color, file: number, rank: number) => {
    const prefix = `${color[0]}${type}`;
    const n = (counters[prefix] = (counters[prefix] ?? -1) + 1);
    pieces.push({ id: `${prefix}${n}`, type, color, pos: { file, rank } });
  };
  for (let f = 0; f < size; f++) {
    add(back[f]!, 'white', f, 0);
    add('P', 'white', f, 1);
    add('P', 'black', f, size - 2);
    add(back[f]!, 'black', f, size - 1);
  }
  const state: GameState = { size, pieces, grid: [], sequence: 0, winner: null };
  rebuildGrid(state);
  return state;
}

/** Copie profonde de l'état (pièces et cases recopiées ; bien plus rapide qu'un aller-retour JSON). */
export const cloneState = (s: GameState): GameState => ({
  ...s,
  pieces: s.pieces.map((p) => ({ ...p, pos: { file: p.pos.file, rank: p.pos.rank } })),
  grid: s.grid.slice(),
});
