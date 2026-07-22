export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!Number.isFinite(left) || !Number.isFinite(right)) return -1;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  return normA > 0 && normB > 0 ? dot / Math.sqrt(normA * normB) : -1;
}
