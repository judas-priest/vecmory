#!/usr/bin/env bash
# VecMory auto-recall hook for Claude Code
# Runs on UserPromptSubmit — recalls relevant memories before each response
# Exit 0 = stdout injected into context; exit 1 = warning shown, continues
[ "${VECMORY_AUTO:-1}" = "0" ] && exit 0

DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/.env" 2>/dev/null

exec node --input-type=module -e "
import { IntegramClient } from '$DIR/src/integram-client.js';
import { Embedder } from '$DIR/src/embedder.js';
import { VecMory } from '$DIR/src/index.js';

const env = process.env;
const client = new IntegramClient({
  baseUrl: env.VECMORY_BASE_URL,
  token: env.VECMORY_TOKEN,
  db: env.VECMORY_DB,
  tableId: env.VECMORY_TABLE_ID,
});
const embedder = new Embedder({ model: env.VECMORY_MODEL });
const fields = {
  text: \`t\${env.VECMORY_FIELD_TEXT}\`,
  vec: \`t\${env.VECMORY_FIELD_VEC}\`,
  neighbors: \`t\${env.VECMORY_FIELD_NEIGHBORS}\`,
  cleaned_query: \`t\${env.VECMORY_FIELD_CLEANED_QUERY}\`,
  domain: \`t\${env.VECMORY_FIELD_DOMAIN}\`,
  topic: \`t\${env.VECMORY_FIELD_TOPIC}\`,
  essence: \`t\${env.VECMORY_FIELD_ESSENCE}\`,
  popularity: \`t\${env.VECMORY_FIELD_POPULARITY}\`,
  decay: \`t\${env.VECMORY_FIELD_DECAY}\`,
  importance: \`t\${env.VECMORY_FIELD_IMPORTANCE}\`,
  edge_types: \`t\${env.VECMORY_FIELD_EDGE_TYPES}\`,
};
const vm = new VecMory({ client, embedder, fields, topK: 5 });
await vm.init();
const result = await vm.recall(process.argv[1] || '', 5);
if (result.nodes.length > 0) {
  console.log('## VecMory — relevant memories');
  for (const n of result.nodes) {
    console.log('- [' + (n.domain || '?') + '/' + (n.topic || '?') + '] ' + n.text.slice(0, 200));
  }
  if (result.garland) console.log('Chain: ' + result.garland.slice(0, 300));
}
" -- "$CLAUDE_USER_PROMPT" 2>/dev/null
