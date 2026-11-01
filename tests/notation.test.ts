import { describe, expect, it } from 'vitest';
import { createCustomState } from '../src/core/board';
import { notate, sqName } from '../src/ui/notation';

const P = (file: number, rank: number) => ({ file, rank });
/** Retire les balises HTML des figurines, pour comparer le texte. */
const text = (html: string) => html.replace(/<[^>]+>/g, '');
const kings = [
  { id: 'wK', type: 'K' as const, color: 'white' as const, file: 2, rank: 0 },
  { id: 'bK', type: 'K' as const, color: 'black' as const, file: 2, rank: 4 },
];

describe('notation algébrique du journal', () => {
  it('noms des cases', () => {
    expect(sqName(P(0, 0))).toBe('a1');
    expect(sqName(P(4, 4))).toBe('e5');
  });

  it('pièce, capture, pion, promotion', () => {
    const s = createCustomState([
      ...kings,
      { id: 'wN', type: 'N', color: 'white', file: 3, rank: 0 },
      { id: 'wP', type: 'P', color: 'white', file: 1, rank: 2 },
      { id: 'bR', type: 'R', color: 'black', file: 0, rank: 3 },
    ]);
    const piece = (id: string) => s.pieces.find((p) => p.id === id)!;
    expect(text(notate(piece('wN'), P(2, 2), s, false))).toBe('♘c3');
    expect(text(notate(piece('wP'), P(1, 3), s, false))).toBe('b4');
    expect(text(notate(piece('wP'), P(0, 3), s, true))).toBe('bxa4');
    expect(text(notate(piece('bR'), P(0, 1), s, false))).toBe('♜a2');
    expect(text(notate(piece('wP'), P(1, 4), s, false, 'N'))).toBe('b5=♘');
  });

  it('deux pièces identiques peuvent aller sur la case : colonne, ou rangée si même colonne', () => {
    const s = createCustomState([
      ...kings,
      { id: 'wR0', type: 'R', color: 'white', file: 0, rank: 1 },
      { id: 'wR1', type: 'R', color: 'white', file: 4, rank: 1 },
      { id: 'bR0', type: 'R', color: 'black', file: 0, rank: 3 },
      { id: 'bR1', type: 'R', color: 'black', file: 0, rank: 2 },
    ]);
    const piece = (id: string) => s.pieces.find((p) => p.id === id)!;
    expect(text(notate(piece('wR0'), P(2, 1), s, false))).toBe('♖ac2');
    expect(text(notate(piece('bR0'), P(0, 0), s, false))).toBe('♜4a1');
  });
});
