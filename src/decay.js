export function applyDecay(nodes, decayRate) {
  return nodes.map(node => ({
    ...node,
    decay_score: node.decay_score * decayRate,
  }));
}

export function findArchivable(nodes, threshold) {
  return nodes.filter(
    node => node.decay_score < threshold && node.popularity_counter <= 1
  );
}
