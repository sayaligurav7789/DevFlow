import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, splitIntoChunks } from '../src/services/ai.service.js';

test('splits long document text into overlapping bounded chunks', () => {
  const text = 'alpha '.repeat(800);
  const chunks = splitIntoChunks(text, 1200, 180);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1200));
  assert.ok(chunks[0].length > 0);
});

test('computes cosine similarity and rejects incompatible vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1], [1, 2]), -1);
});
