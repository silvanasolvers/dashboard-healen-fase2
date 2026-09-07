export type ClosureDateRange = {
  from: string;
  to: string;
};

export function closuresForRange<T extends { date: string }>(closures: T[], range: ClosureDateRange): T[] {
  return closures
    .filter((item) => (!range.from || item.date >= range.from) && (!range.to || item.date <= range.to))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
}
