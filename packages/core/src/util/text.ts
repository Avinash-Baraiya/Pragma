/**
 * Normalize a human term for matching: splits camelCase, treats `_ - .` as spaces,
 * lower-cases, applies NFKC and collapses whitespace.
 *
 * `createdAt`, `created_at`, `Created At` and `created-at` all become `created at`.
 *
 * @public
 */
export function normalizeTerm(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Damerau-free Levenshtein distance with an early-exit bound. Returns `max + 1`
 * when the distance exceeds `max`.
 *
 * @internal
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}
