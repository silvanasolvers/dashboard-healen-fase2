const CATEGORY_VISUAL_TONE_COUNT = 6;

export function categoryVisualClass(index: number): string {
  const tone = ((index % CATEGORY_VISUAL_TONE_COUNT) + CATEGORY_VISUAL_TONE_COUNT) % CATEGORY_VISUAL_TONE_COUNT;
  return `category-visual--${tone}`;
}
