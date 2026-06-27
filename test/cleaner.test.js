import { describe, it, expect } from 'vitest';
import { cleanText } from '../src/cleaner.js';

describe('cleanText', () => {
  it('removes UUIDs', () => {
    const input = 'Error in object 550e8400-e29b-41d4-a716-446655440000 failed';
    expect(cleanText(input)).toBe('Error in object failed');
  });

  it('removes numeric IDs (standalone numbers 4+ digits)', () => {
    expect(cleanText('Row 123456 in table 78')).toBe('Row in table 78');
  });

  it('removes hex hashes (8+ chars)', () => {
    expect(cleanText('Commit a1b2c3d4e5 broke build')).toBe('Commit broke build');
  });

  it('collapses whitespace', () => {
    expect(cleanText('too   many    spaces')).toBe('too many spaces');
  });

  it('trims', () => {
    expect(cleanText('  hello  ')).toBe('hello');
  });

  it('preserves meaningful short numbers', () => {
    expect(cleanText('HTTP 404 error on port 80')).toBe('HTTP 404 error on port 80');
  });

  it('handles empty input', () => {
    expect(cleanText('')).toBe('');
  });
});
