export const EDGE_TYPES = {
  SIMILAR_TO: 'SIMILAR_TO',
  CAUSED_BY: 'CAUSED_BY',
  FOLLOWED_BY: 'FOLLOWED_BY',
  BELONGS_TO: 'BELONGS_TO',
  REFERENCES: 'REFERENCES',
};

export function addEdge(node, neighborId, edgeType) {
  if (!node.neighbors.includes(neighborId)) {
    node.neighbors.push(neighborId);
  }
  node.edge_types[String(neighborId)] = edgeType;
}

export function removeNodeEdges(node, neighborId) {
  node.neighbors = node.neighbors.filter(n => n !== neighborId);
  delete node.edge_types[String(neighborId)];
}

export async function garland(startId, depth, getNodeFn) {
  const visited = new Set([startId]);
  const result = [];
  let frontier = [{ id: startId, node: await getNodeFn(startId) }];

  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const nextFrontier = [];
    for (const { node } of frontier) {
      if (!node || !node.neighbors) continue;
      for (const nbrId of node.neighbors) {
        if (visited.has(nbrId)) continue;
        visited.add(nbrId);
        const nbrNode = await getNodeFn(nbrId);
        if (!nbrNode) continue;
        const edgeType = node.edge_types[String(nbrId)] || 'SIMILAR_TO';
        result.push({ id: nbrId, text: nbrNode.raw_input, edgeType, depth: d });
        nextFrontier.push({ id: nbrId, node: nbrNode });
      }
    }
    frontier = nextFrontier;
  }

  return result;
}
