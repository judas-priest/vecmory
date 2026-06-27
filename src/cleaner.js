const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_NUM_RE = /\b\d{4,}\b/g;
const HEX_HASH_RE = /\b[0-9a-f]{8,}\b/g;
const MULTI_SPACE_RE = /\s{2,}/g;

export function cleanText(text) {
  if (!text) return '';
  return text
    .replace(UUID_RE, '')
    .replace(HEX_HASH_RE, '')
    .replace(LONG_NUM_RE, '')
    .replace(MULTI_SPACE_RE, ' ')
    .trim();
}
