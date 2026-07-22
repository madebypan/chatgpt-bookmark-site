import assert from "node:assert/strict";
import test from "node:test";
import { cosineSimilarity } from "../lib/vector.ts";

test("cosine similarity ranks aligned vectors and rejects invalid shapes", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([1], [1, 0]), -1);
  assert.equal(cosineSimilarity([], []), -1);
  assert.equal(cosineSimilarity([Number.NaN], [1]), -1);
});
