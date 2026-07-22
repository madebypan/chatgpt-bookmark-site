import assert from "node:assert/strict";
import test from "node:test";
import { supportedFileSearchRawMime } from "../lib/file-search-mime.ts";

test("uses images only with a multimodal File Search store", () => {
  assert.equal(supportedFileSearchRawMime("image/png", true), true);
  assert.equal(supportedFileSearchRawMime("image/jpeg", true), true);
  assert.equal(supportedFileSearchRawMime("image/png", false), false);
  assert.equal(supportedFileSearchRawMime("image/webp", true), false);
});

test("keeps supported documents and rejects web pages, audio, and video", () => {
  assert.equal(supportedFileSearchRawMime("text/markdown", false), true);
  assert.equal(supportedFileSearchRawMime("application/pdf", false), true);
  assert.equal(supportedFileSearchRawMime("text/html", false), false);
  assert.equal(supportedFileSearchRawMime("audio/mpeg", true), false);
  assert.equal(supportedFileSearchRawMime("video/mp4", true), false);
});
