import { describe, expect, it } from 'vitest';
import { categoryVisualClass } from '../src/categoryPalette';

describe('categoryVisualClass', () => {
  it('assigns six distinct visible tones before repeating', () => {
    const firstSix = Array.from({ length: 6 }, (_, index) => categoryVisualClass(index));

    expect(new Set(firstSix).size).toBe(6);
    expect(firstSix.every((className) => className.startsWith('category-visual--'))).toBe(true);
    expect(categoryVisualClass(6)).toBe(firstSix[0]);
  });
});
