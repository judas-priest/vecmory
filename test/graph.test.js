import { describe, it, expect } from 'vitest';
import { addEdge, removeNodeEdges, garland, EDGE_TYPES } from '../src/graph.js';

describe('EDGE_TYPES', () => {
  it('has all 5 types', () => {
    expect(Object.keys(EDGE_TYPES)).toEqual([
      'SIMILAR_TO', 'CAUSED_BY', 'FOLLOWED_BY', 'BELONGS_TO', 'REFERENCES',
    ]);
  });
});

describe('addEdge', () => {
  it('adds neighbor and edge type to node', () => {
    const node = { neighbors: [], edge_types: {} };
    addEdge(node, 42, 'SIMILAR_TO');
    expect(node.neighbors).toEqual([42]);
    expect(node.edge_types['42']).toBe('SIMILAR_TO');
  });

  it('does not duplicate neighbor', () => {
    const node = { neighbors: [42], edge_types: { '42': 'SIMILAR_TO' } };
    addEdge(node, 42, 'CAUSED_BY');
    expect(node.neighbors).toEqual([42]);
    expect(node.edge_types['42']).toBe('CAUSED_BY');
  });
});

describe('removeNodeEdges', () => {
  it('removes a specific neighbor', () => {
    const node = { neighbors: [1, 2, 3], edge_types: { '1': 'SIMILAR_TO', '2': 'CAUSED_BY', '3': 'SIMILAR_TO' } };
    removeNodeEdges(node, 2);
    expect(node.neighbors).toEqual([1, 3]);
    expect(node.edge_types).toEqual({ '1': 'SIMILAR_TO', '3': 'SIMILAR_TO' });
  });
});

describe('garland', () => {
  it('traverses graph BFS to given depth', () => {
    const getNode = async (id) => {
      const graph = {
        1: { id: 1, raw_input: 'node1', neighbors: [2, 3], edge_types: { '2': 'SIMILAR_TO', '3': 'CAUSED_BY' } },
        2: { id: 2, raw_input: 'node2', neighbors: [4], edge_types: { '4': 'SIMILAR_TO' } },
        3: { id: 3, raw_input: 'node3', neighbors: [], edge_types: {} },
        4: { id: 4, raw_input: 'node4', neighbors: [], edge_types: {} },
      };
      return graph[id] || null;
    };

    return garland(1, 2, getNode).then(result => {
      expect(result.map(n => n.id)).toEqual([2, 3, 4]);
      expect(result[0]).toEqual({ id: 2, text: 'node2', edgeType: 'SIMILAR_TO', depth: 1 });
      expect(result[1]).toEqual({ id: 3, text: 'node3', edgeType: 'CAUSED_BY', depth: 1 });
      expect(result[2]).toEqual({ id: 4, text: 'node4', edgeType: 'SIMILAR_TO', depth: 2 });
    });
  });

  it('does not revisit nodes', async () => {
    const getNode = async (id) => {
      const graph = {
        1: { id: 1, raw_input: 'a', neighbors: [2], edge_types: { '2': 'SIMILAR_TO' } },
        2: { id: 2, raw_input: 'b', neighbors: [1], edge_types: { '1': 'SIMILAR_TO' } },
      };
      return graph[id] || null;
    };
    const result = await garland(1, 3, getNode);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it('returns empty for node with no neighbors', async () => {
    const getNode = async (id) => ({ id, raw_input: 'lonely', neighbors: [], edge_types: {} });
    const result = await garland(1, 2, getNode);
    expect(result).toEqual([]);
  });
});
