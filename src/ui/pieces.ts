import type { PieceType } from '../core/types';

/**
 * Silhouettes SVG dessinées pour le jeu (viewBox 100x100).
 * `.s` = forme remplie (dégradé selon la couleur), `.d` = trait de détail, `.eye` = œil du cavalier.
 * Les dégradés (#g-white, #g-black) sont définis une fois dans PIECE_DEFS.
 */
const PLINTH = '<path class="s" d="M24 80 h52 a5 5 0 0 1 5 5 v3 a3 3 0 0 1 -3 3 h-56 a3 3 0 0 1 -3 -3 v-3 a5 5 0 0 1 5 -5z"/>';

const SHAPES: Record<PieceType, string> = {
  P: '<circle class="s" cx="50" cy="30" r="12"/><path class="s" d="M41 41 h18 l2 7 h-22z"/><path class="s" d="M37 80 C37 62 43 54 50 48 C57 54 63 62 63 80z"/>',
  R: '<path class="s" d="M29 17 h11 v7 h6 v-7 h8 v7 h6 v-7 h11 v21 H29z"/><path class="s" d="M34 36 h32 l-4 44 h-24z"/><path class="d" d="M36 50 H64"/>',
  B: '<circle class="s" cx="50" cy="15" r="5.5"/><path class="s" d="M50 21 C71 33 69 53 58 59 L65 80 H35 L42 59 C31 53 29 33 50 21z"/><path class="d" d="M45 34 L58 47"/>',
  N: '<path class="s" d="M31 80 C29 58 38 48 46 40 C40 40 35 43 30 48 L26 40 C31 30 40 22 52 19 L55 10 L63 19 C76 26 75 50 71 80z"/><circle class="eye" cx="53" cy="30" r="3"/><path class="d" d="M62 25 C66 33 64 42 59 47"/>',
  Q: '<path class="s" d="M30 80 L23 32 L38 51 L44 24 L50 47 L56 24 L62 51 L77 32 L70 80z"/><circle class="s" cx="23" cy="29" r="4.5"/><circle class="s" cx="44" cy="21" r="4.5"/><circle class="s" cx="56" cy="21" r="4.5"/><circle class="s" cx="77" cy="29" r="4.5"/><path class="d" d="M35 66 H65"/>',
  K: '<path class="s" d="M46 6 h8 v8 h8 v8 h-8 v8 h-8 v-8 h-8 v-8 h8z"/><path class="s" d="M31 80 C29 60 36 46 50 40 C64 46 71 60 69 80z"/><path class="d" d="M37 63 H63"/>',
};

export const PIECE_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="g-white" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f1e8d2"/><stop offset="1" stop-color="#c9bb97"/></linearGradient>
  <linearGradient id="g-black" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b7290"/><stop offset=".5" stop-color="#2a2e42"/><stop offset="1" stop-color="#10121b"/></linearGradient>
</defs></svg>`;

export const pieceSvg = (type: PieceType): string =>
  `<svg viewBox="0 0 100 100" class="pc">${SHAPES[type]}${PLINTH}</svg>`;
