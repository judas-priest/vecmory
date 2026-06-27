#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { IntegramClient } from './integram-client.js';
import { Embedder } from './embedder.js';
import { VecMory } from './index.js';

const env = process.env;

const client = new IntegramClient({
  baseUrl: env.VECMORY_BASE_URL,
  token: env.VECMORY_TOKEN,
  db: env.VECMORY_DB,
  tableId: env.VECMORY_TABLE_ID,
});

const embedder = new Embedder({
  model: env.VECMORY_MODEL,
});

const fields = {
  text: `t${env.VECMORY_FIELD_TEXT}`,
  vec: `t${env.VECMORY_FIELD_VEC}`,
  neighbors: `t${env.VECMORY_FIELD_NEIGHBORS}`,
  cleaned_query: `t${env.VECMORY_FIELD_CLEANED_QUERY}`,
  domain: `t${env.VECMORY_FIELD_DOMAIN}`,
  topic: `t${env.VECMORY_FIELD_TOPIC}`,
  essence: `t${env.VECMORY_FIELD_ESSENCE}`,
  popularity: `t${env.VECMORY_FIELD_POPULARITY}`,
  decay: `t${env.VECMORY_FIELD_DECAY}`,
  importance: `t${env.VECMORY_FIELD_IMPORTANCE}`,
  edge_types: `t${env.VECMORY_FIELD_EDGE_TYPES}`,
};

const vm = new VecMory({
  client,
  embedder,
  fields,
  topK: parseInt(env.VECMORY_TOP_K || '16', 10),
  garlandDepth: parseInt(env.VECMORY_GARLAND_DEPTH || '2', 10),
  decayRate: parseFloat(env.VECMORY_DECAY_RATE || '0.95'),
  decayThreshold: parseFloat(env.VECMORY_DECAY_THRESHOLD || '0.1'),
});

const server = new Server(
  { name: 'vecmory', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'recall',
    description: 'Semantic search in memory. Returns relevant nodes with garland chain.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text' },
        k: { type: 'number', description: 'Number of results (default: configured topK)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember',
    description: 'Store a fact, solution, or lesson in memory.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to remember' },
        domain: { type: 'string', description: 'Category: integrations, infra, project_X, etc.' },
        topic: { type: 'string', description: 'Type: bug_fix, feature_request, question' },
        essence: { type: 'array', items: { type: 'string' }, description: '1-3 keywords' },
      },
      required: ['text'],
    },
  },
  {
    name: 'forget',
    description: 'Delete a node and its edges from memory.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'number', description: 'ID of the node to delete' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'memory_status',
    description: 'Memory statistics: total nodes, edges, domains, recent activity.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'recall': {
        const result = await vm.recall(args.query, args.k);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'remember': {
        const result = await vm.remember(args.text, {
          domain: args.domain,
          topic: args.topic,
          essence: args.essence,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'forget': {
        await vm.forget(args.nodeId);
        return { content: [{ type: 'text', text: `Node ${args.nodeId} deleted.` }] };
      }
      case 'memory_status': {
        const result = await vm.status();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  await vm.init();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('VecMory startup error:', err);
  process.exit(1);
});
