/** Nearest-rank percentile of an unsorted sample. */
export function pct(sample: number[], p: number): number {
  if (sample.length === 0) return NaN;
  const s = [...sample].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
