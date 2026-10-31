import type { Color, GameState, PieceState, PieceType, Square } from './types';

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
  size = 8,
): GameState {
  const state: GameState = {
    size,
    pieces: pieces.map((p) => ({
      id: p.id,
      type: p.type,
      color: p.color,
      pos: { file: p.file, rank: p.rank },
      hasMoved: false,
    })),
    grid: [],
    sequence: 0,
    winner: null,
  };
  rebuildGrid(state);
  return state;
}

/** Position de départ des échecs classiques (8x8). */
export function createInitialState(): GameState {
  const back: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const pieces: PieceState[] = [];
  const counters: Record<string, number> = {};
  const add = (type: PieceType, color: Color, file: number, rank: number) => {
    const prefix = `${color[0]}${type}`;
    const n = (counters[prefix] = (counters[prefix] ?? -1) + 1);
    pieces.push({ id: `${prefix}${n}`, type, color, pos: { file, rank }, hasMoved: false });
  };
  for (let f = 0; f < 8; f++) {
    add(back[f]!, 'white', f, 0);
    add('P', 'white', f, 1);
    add('P', 'black', f, 6);
    add(back[f]!, 'black', f, 7);
  }
  const state: GameState = { size: 8, pieces, grid: [], sequence: 0, winner: null };
  rebuildGrid(state);
  return state;
}

// L'état est du JSON pur : un aller-retour JSON suffit (et évite une dépendance aux types DOM/Node).
export const cloneState = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;
