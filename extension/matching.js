export function normalizeReading(s = '') {
  return s.normalize('NFKC').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[^ぁ-ゖーa-z0-9]/gi, '').toLowerCase();
}
export function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) { const next = [i + 1]; for (let j = 0; j < b.length; j++) next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)); row = next; }
  return row[b.length];
}
export function matchReading(expected, actual) {
  const a = normalizeReading(expected), b = normalizeReading(actual);
  if (!a || !b) return { passed: false, similarity: 0 };
  const similarity = Math.max(0, 1 - distance(a, b) / Math.max(a.length, b.length));
  return { passed: a.length <= 5 ? a === b : similarity >= 0.8, similarity: Math.round(similarity * 100) };
}
