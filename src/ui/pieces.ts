import type { PieceType } from '../core/types';

/**
 * Sprites pixel art 11x12 : '#' = corps, 'x' = détail sombre (œil, fente), '.' = vide.
 * Le contour noir (`o`) et l'ombrage du côté droit/bas (`s`) sont déduits automatiquement ;
 * la teinte (crème / rose) vient du CSS (`.w` / `.b`).
 */
const SPRITES: Record<PieceType, string[]> = {
  P: [
    '....###....',
    '...#####...',
    '...#####...',
    '....###....',
    '...#####...',
    '....###....',
    '...#####...',
    '..#######..',
    '..#######..',
    '...#####...',
    '.#########.',
    '.#########.',
  ],
  R: [
    '.##.###.##.',
    '.#########.',
    '...#####...',
    '...#####...',
    '...#####...',
    '...#####...',
    '...#####...',
    '...#####...',
    '..#######..',
    '.#########.',
    '.#########.',
    '...........',
  ],
  B: [
    '.....#.....',
    '....###....',
    '...###x#...',
    '...##x##...',
    '...#x###...',
    '....###....',
    '..#######..',
    '...#####...',
    '...#####...',
    '..#######..',
    '.#########.',
    '.#########.',
  ],
  N: [
    '...#.#.....',
    '..#####....',
    '.#x######..',
    '##########.',
    '#########..',
    '.###.####..',
    '....#####..',
    '...######..',
    '...#######.',
    '..#########',
    '.#########.',
    '.#########.',
  ],
  Q: [
    '#..#.#.#..#',
    '##.#####.##',
    '.#########.',
    '..#######..',
    '...#####...',
    '...#####...',
    '..#######..',
    '.#########.',
    '.#########.',
    '...........',
    '...........',
    '...........',
  ],
  K: [
    '.....#.....',
    '....###....',
    '.....#.....',
    '..#######..',
    '..#######..',
    '..#######..',
    '...#####...',
    '...#####...',
    '...#####...',
    '..#######..',
    '.#########.',
    '.#########.',
  ],
};

function spriteSvg(rows: string[]): string {
  const w = rows[0]!.length + 2;
  const h = rows.length + 2;
  const at = (x: number, y: number) => rows[y - 1]?.[x - 1] ?? '.';
  const body = (x: number, y: number) => at(x, y) === '#' || at(x, y) === 'x';
  let rects = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let cls = '';
    if (at(x, y) === 'x') cls = 'o';
    else if (at(x, y) === '#') cls = !body(x + 1, y) || !body(x, y + 1) ? 's' : 'f';
    else if (body(x - 1, y) || body(x + 1, y) || body(x, y - 1) || body(x, y + 1)) cls = 'o';
    if (cls) rects += `<rect class="${cls}" x="${x}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="pc" shape-rendering="crispEdges">${rects}</svg>`;
}

const CACHE = new Map<PieceType, string>();
export const pieceSvg = (type: PieceType): string => {
  let svg = CACHE.get(type);
  if (!svg) CACHE.set(type, (svg = spriteSvg(SPRITES[type])));
  return svg;
};

/** Plus de définitions partagées : les sprites sont des aplats de pixels teintés par le CSS. */
export const PIECE_DEFS = '';
