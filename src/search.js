export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function findTopK(query, corpus, k, { excludeIds } = {}) {
  const scored = [];
  for (const node of corpus) {
    if (excludeIds && excludeIds.has(node.id)) continue;
    const score = cosineSimilarity(query, node.embedding);
    scored.push({ id: node.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
