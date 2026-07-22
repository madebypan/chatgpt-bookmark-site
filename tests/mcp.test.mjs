import assert from "node:assert/strict";
import test from "node:test";
import { createMcpEndpoint } from "../lib/mcp.ts";

const baseAdapter = {
  authorize: async () => ({ authorized: true, principal: { subject: "owner" } }),
  searchLibrary: async ({ query, limit }) => Array.from({ length: limit }, (_, index) => ({
    id: `bookmark-${index + 1}`,
    title: `Result ${index + 1}`,
    url: `https://example.com/${index + 1}`,
    snippet: `${query} snippet`,
    status: "ready",
    createdAt: "2026-07-12T00:00:00.000Z",
  })),
  readBookmark: async ({ bookmarkId, fromChunk, maxChunks }) => bookmarkId === "missing" ? null : ({
    id: bookmarkId,
    title: "Long document",
    url: "https://example.com/long",
    canonicalUrl: "https://example.com/long",
    status: "ready",
    revision: "revision-1",
    chunkCount: 8,
    indexTruncated: false,
    chunks: Array.from({ length: maxChunks }, (_, index) => ({
      chunkId: `${bookmarkId}:${fromChunk + index}`,
      ordinal: fromChunk + index,
      heading: "Section",
      text: "x".repeat(1_000),
    })),
    nextFrom: fromChunk + maxChunks < 8 ? fromChunk + maxChunks : null,
  }),
  listRecent: async ({ limit }) => Array.from({ length: limit }, (_, index) => ({
    id: `recent-${index + 1}`,
    title: `Recent ${index + 1}`,
    url: `https://example.com/recent/${index + 1}`,
    status: "ready",
  })),
  askLibrary: async ({ question }) => ({
    answered: true,
    answer: `Grounded answer for: ${question}`,
    refusalReason: null,
    citations: [{
      citationId: "citation-1",
      bookmarkId: "bookmark-1",
      revision: "revision-1",
      title: "Grounded source",
      url: "https://example.com/source",
      excerpt: "The saved source supports this answer.",
      pageNumber: 2,
      claims: ["The answer is grounded."],
    }],
    index: {
      configured: true,
      storeReady: true,
      total: 13,
      indexed: 13,
      pending: 0,
      indexing: 0,
      failed: 0,
      complete: true,
      error: null,
    },
    warning: null,
  }),
};

const endpoint = createMcpEndpoint(baseAdapter, {
  serverName: "test-relay",
  serverVersion: "9.9.9",
});

function rpcRequest(payload, headers = {}) {
  return new Request("https://relay.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

test("MCP initialize negotiates a supported version without creating a session", async () => {
  const response = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-session-id"), null);
  assert.equal(response.headers.get("mcp-protocol-version"), "2025-11-25");
  const body = await response.json();
  assert.equal(body.result.protocolVersion, "2025-11-25");
  assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(body.result.serverInfo, { name: "test-relay", version: "9.9.9" });
});

test("tools/list exposes all four read-only library tools", async () => {
  const response = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: "tools",
    method: "tools/list",
    params: {},
  }));
  const body = await response.json();
  assert.deepEqual(
    body.result.tools.map((tool) => tool.name),
    ["search_library", "ask_library", "read_bookmark", "list_recent_bookmarks"],
  );
  for (const tool of body.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, true);
  }
});

test("ask_library returns a cited semantic answer with index readiness", async () => {
  const response = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: "ask",
    method: "tools/call",
    params: {
      name: "ask_library",
      arguments: { question: "  What does my library say?  " },
    },
  }));
  const body = await response.json();
  const result = body.result.structuredContent;

  assert.equal(result.answered, true);
  assert.equal(result.answer, "Grounded answer for: What does my library say?");
  assert.equal(result.refusal_reason, null);
  assert.equal(result.citations.length, 1);
  assert.deepEqual(result.citations[0], {
    citation_id: "citation-1",
    bookmark_id: "bookmark-1",
    revision: "revision-1",
    title: "Grounded source",
    url: "https://example.com/source",
    excerpt: "The saved source supports this answer.",
    page_number: 2,
    claims: ["The answer is grounded."],
  });
  assert.deepEqual(result.index, {
    configured: true,
    store_ready: true,
    total: 13,
    indexed: 13,
    pending: 0,
    indexing: 0,
    failed: 0,
    complete: true,
  });
  assert.equal(result.warning, null);
});

test("ask_library refuses an uncited answer and rejects invalid arguments", async () => {
  const uncitedEndpoint = createMcpEndpoint({
    ...baseAdapter,
    askLibrary: async () => ({
      answered: true,
      answer: "This must not be presented as grounded.",
      refusalReason: null,
      citations: [],
      index: {
        configured: true,
        storeReady: true,
        total: 13,
        indexed: 13,
        pending: 0,
        indexing: 0,
        failed: 0,
        complete: true,
        error: null,
      },
      warning: "No verified citation was returned.",
    }),
  });
  const uncited = await uncitedEndpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: "uncited",
    method: "tools/call",
    params: {
      name: "ask_library",
      arguments: { question: "What is unsupported?" },
    },
  }));
  const uncitedResult = (await uncited.json()).result.structuredContent;
  assert.equal(uncitedResult.answered, false);
  assert.equal(uncitedResult.refusal_reason, "insufficient_evidence");
  assert.deepEqual(uncitedResult.citations, []);

  for (const argumentsValue of [
    { question: "   " },
    { question: "valid", extra: true },
    { question: "x".repeat(1_001) },
  ]) {
    const invalid = await endpoint.POST(rpcRequest({
      jsonrpc: "2.0",
      id: "invalid-ask",
      method: "tools/call",
      params: { name: "ask_library", arguments: argumentsValue },
    }));
    assert.equal((await invalid.json()).result.isError, true);
  }
});

test("tools/call validates limits and returns structured search results", async () => {
  const response = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "search_library",
      arguments: { query: "retrieval", limit: 2 },
    },
  }));
  const body = await response.json();
  assert.equal(body.result.structuredContent.query, "retrieval");
  assert.equal(body.result.structuredContent.count, 2);
  assert.equal(body.result.structuredContent.items[0].snippet, "retrieval snippet");

  const invalid = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "search_library",
      arguments: { query: "retrieval", limit: 21 },
    },
  }));
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.result.isError, true);
});

test("read_bookmark returns a bounded, paginated set of content chunks", async () => {
  const response = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "read_bookmark",
      arguments: { bookmark_id: "bookmark-1", from_chunk: 2, max_chunks: 2 },
    },
  }));
  const body = await response.json();
  assert.equal(body.result.structuredContent.found, true);
  assert.equal(body.result.structuredContent.bookmark.chunks.length, 2);
  assert.equal(body.result.structuredContent.bookmark.chunks[0].ordinal, 2);
  assert.equal(body.result.structuredContent.bookmark.next_from, 4);
});

test("notifications receive 202 with no response body", async () => {
  const response = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  }));
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
});

test("stateless GET and DELETE explicitly reject streams and sessions", async () => {
  const getResponse = await endpoint.GET(new Request("https://relay.example/mcp"));
  const deleteResponse = await endpoint.DELETE(new Request("https://relay.example/mcp", {
    method: "DELETE",
  }));
  assert.equal(getResponse.status, 405);
  assert.equal(deleteResponse.status, 405);
  assert.equal(getResponse.headers.get("allow"), "POST");
  assert.equal(deleteResponse.headers.get("allow"), "POST");
});

test("authorization challenges and Origin validation happen before dispatch", async () => {
  const protectedEndpoint = createMcpEndpoint({
    ...baseAdapter,
    authorize: async () => ({
      authorized: false,
      status: 401,
      message: "Token required.",
      challenge: 'Bearer realm="test", scope="library:read"',
    }),
  });
  const unauthorized = await protectedEndpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/list",
  }));
  assert.equal(unauthorized.status, 401);
  assert.equal(
    unauthorized.headers.get("www-authenticate"),
    'Bearer realm="test", scope="library:read"',
  );

  const crossOrigin = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/list",
  }, { Origin: "https://attacker.example" }));
  assert.equal(crossOrigin.status, 403);
});

test("transport rejects batches, unsupported versions, and oversized bodies", async () => {
  const batch = await endpoint.POST(rpcRequest([{
    jsonrpc: "2.0",
    id: 7,
    method: "tools/list",
  }]));
  assert.equal(batch.status, 400);
  assert.equal((await batch.json()).error.code, -32600);

  const unsupported = await endpoint.POST(rpcRequest({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/list",
  }, { "MCP-Protocol-Version": "2099-01-01" }));
  assert.equal(unsupported.status, 400);

  const tooLarge = await endpoint.POST(new Request("https://relay.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Content-Length": "999999",
    },
    body: "{}",
  }));
  assert.equal(tooLarge.status, 413);
});
