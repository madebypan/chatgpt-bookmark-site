import assert from "node:assert/strict";
import test from "node:test";
import {
  createGeminiFileSearchClient,
  GeminiFileSearchError,
} from "../lib/gemini-file-search-client.ts";

const API_KEY = "test-key-that-must-stay-in-a-header";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

test("creates an embedding-2 store without putting the API key in the URL", async () => {
  const calls = [];
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({
        name: "fileSearchStores/owner-library",
        displayName: "bookmark-site-library",
        embeddingModel: "models/gemini-embedding-2",
      });
    },
  });

  const store = await client.createStore("bookmark-site-library");

  assert.deepEqual(store, {
    name: "fileSearchStores/owner-library",
    displayName: "bookmark-site-library",
    embeddingModel: "models/gemini-embedding-2",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "https://generativelanguage.googleapis.com/v1beta/fileSearchStores");
  assert.equal(new Headers(calls[0].init.headers).get("x-goog-api-key"), API_KEY);
  assert.equal(calls[0].input.includes(API_KEY), false);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    displayName: "bookmark-site-library",
    embeddingModel: "models/gemini-embedding-2",
  });
});

test("can let File Search choose its default text embedding model", async () => {
  let requestBody;
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse({
        name: "fileSearchStores/owner-library",
        displayName: "bookmark-site-library",
      });
    },
  });

  const store = await client.createStore("bookmark-site-library", null);

  assert.deepEqual(requestBody, { displayName: "bookmark-site-library" });
  assert.equal(store.embeddingModel, "models/gemini-embedding-001");
});

test("can omit every optional store field and the request body", async () => {
  let requestInit;
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (_input, init) => {
      requestInit = init;
      return jsonResponse({ name: "fileSearchStores/generated-store" });
    },
  });

  const store = await client.createStore(null, null);

  assert.equal(requestInit.body, undefined);
  assert.equal(new Headers(requestInit.headers).has("content-type"), false);
  assert.deepEqual(store, {
    name: "fileSearchStores/generated-store",
    displayName: "",
    embeddingModel: "models/gemini-embedding-001",
  });
});

test("can use Google's documented query authentication only when explicitly requested", async () => {
  let call;
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      call = { input: String(input), init };
      return jsonResponse({
        name: "fileSearchStores/owner-library",
        displayName: "bookmark-site-library",
        embeddingModel: "models/gemini-embedding-2",
      });
    },
  });

  await client.createStore(
    "bookmark-site-library",
    "models/gemini-embedding-2",
    "query",
  );

  const url = new URL(call.input);
  assert.equal(url.origin + url.pathname, "https://generativelanguage.googleapis.com/v1beta/fileSearchStores");
  assert.equal(url.searchParams.get("key"), API_KEY);
  assert.equal(new Headers(call.init.headers).has("x-goog-api-key"), false);
  assert.deepEqual(JSON.parse(call.init.body), {
    displayName: "bookmark-site-library",
    embeddingModel: "models/gemini-embedding-2",
  });
});

test("uploads a document through the trusted resumable endpoint with bounded metadata", async () => {
  const calls = [];
  const uploadUrl = "https://upload.googleapis.com/resumable/file-search-session";
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      const call = { input: String(input), init };
      calls.push(call);
      if (calls.length === 1) {
        return jsonResponse({}, {
          headers: { "x-goog-upload-url": uploadUrl },
        });
      }
      return jsonResponse({
        name: "fileSearchStores/owner-library/upload/operations/op-1",
        done: false,
      });
    },
  });
  const bytes = new TextEncoder().encode("# 一則收藏\n\n完整內容");

  const operation = await client.uploadDocument({
    storeName: "fileSearchStores/owner-library",
    bytes,
    mimeType: "text/markdown; charset=utf-8",
    displayName: "一則收藏",
    metadata: {
      bookmark_id: "bookmark-1",
      revision: "revision-1",
      "not-valid!": "must be filtered",
      empty: "   ",
    },
  });

  assert.deepEqual(operation, {
    name: "fileSearchStores/owner-library/upload/operations/op-1",
    done: false,
    documentName: null,
    error: null,
  });
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].input,
    "https://generativelanguage.googleapis.com/upload/v1beta/fileSearchStores/owner-library:uploadToFileSearchStore",
  );
  const startHeaders = new Headers(calls[0].init.headers);
  assert.equal(startHeaders.get("x-goog-api-key"), API_KEY);
  assert.equal(startHeaders.get("x-goog-upload-command"), "start");
  assert.equal(startHeaders.get("x-goog-upload-header-content-type"), "text/markdown");
  const startBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(startBody.customMetadata, [
    { key: "bookmark_id", stringValue: "bookmark-1" },
    { key: "revision", stringValue: "revision-1" },
  ]);
  assert.deepEqual(startBody.chunkingConfig.whiteSpaceConfig, {
    maxTokensPerChunk: 600,
    maxOverlapTokens: 80,
  });
  assert.equal(calls[1].input, uploadUrl);
  assert.equal(new Headers(calls[1].init.headers).get("x-goog-upload-command"), "upload, finalize");
  assert.deepEqual(new Uint8Array(calls[1].init.body), bytes);
  assert.equal(calls.every((call) => !call.input.includes(API_KEY)), true);
});

test("streams a known-length R2 body without buffering a second copy", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const calls = [];
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      if (calls.length === 1) {
        return jsonResponse({}, {
          headers: {
            "x-goog-upload-url": "https://upload.googleapis.com/resumable/stream-session",
          },
        });
      }
      return jsonResponse({
        name: "fileSearchStores/owner-library/upload/operations/op-stream",
        done: false,
      });
    },
  });

  await client.uploadDocument({
    storeName: "fileSearchStores/owner-library",
    bytes: stream,
    byteLength: 100 * 1024 * 1024,
    mimeType: "application/pdf",
    displayName: "large-source.pdf",
    metadata: {},
  });

  assert.equal(calls[1].init.body, stream);
  assert.equal(
    new Headers(calls[1].init.headers).get("content-length"),
    String(100 * 1024 * 1024),
  );
});

test("retries a rejected upload start with Google's documented query authentication", async () => {
  const calls = [];
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      if (calls.length === 1) {
        return jsonResponse({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 });
      }
      if (calls.length === 2) {
        return jsonResponse({}, {
          headers: { "x-goog-upload-url": "https://upload.googleapis.com/resumable/query-fallback" },
        });
      }
      return jsonResponse({
        name: "fileSearchStores/owner-library/upload/operations/op-query",
        done: false,
      });
    },
  });

  await client.uploadDocument({
    storeName: "fileSearchStores/owner-library",
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "text/plain",
    displayName: "source.txt",
    metadata: {},
  });

  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[0].init.headers).get("x-goog-api-key"), API_KEY);
  const retryUrl = new URL(calls[1].input);
  assert.equal(retryUrl.searchParams.get("key"), API_KEY);
  assert.equal(new Headers(calls[1].init.headers).has("x-goog-api-key"), false);
  assert.equal(calls[2].input, "https://upload.googleapis.com/resumable/query-fallback");
});

test("creates a bounded Gemini Embedding 2 retrieval vector", async () => {
  let call;
  const values = Array.from({ length: 768 }, (_, index) => index / 10_000);
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      call = { input: String(input), init };
      return jsonResponse({ embedding: { values } });
    },
  });

  const vector = await client.embedText("task: question answering | query: 怎麼改善搜尋？");

  assert.deepEqual(vector, values);
  assert.equal(
    call.input,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent",
  );
  assert.equal(new Headers(call.init.headers).get("x-goog-api-key"), API_KEY);
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, undefined);
  assert.equal(body.output_dimensionality, 768);
  assert.equal(body.outputDimensionality, undefined);
  assert.match(body.content.parts[0].text, /question answering/);
});

test("answers from local evidence only with allowlisted citation IDs", async () => {
  let requestBody;
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                answer: "混合檢索能兼顧字面與語意結果。",
                citation_ids: ["S1", "S999", "S1"],
              }),
            }],
          },
        }],
      });
    },
  });

  const answer = await client.answerWithEvidence("怎麼改善搜尋？", [{
    id: "S1",
    title: "檢索筆記",
    text: "混合檢索能兼顧精確字詞與語意。",
    url: "https://example.com/note",
  }]);

  assert.deepEqual(answer, {
    answer: "混合檢索能兼顧字面與語意結果。",
    citationIds: ["S1"],
  });
  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
  assert.match(requestBody.contents[0].parts[0].text, /untrusted data/);
  assert.match(requestBody.contents[0].parts[0].text, /檢索筆記/);
});

test("parses grounded answers, citations, metadata, and claim-to-source links", async () => {
  let requestBody;
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    generationModel: "gemini-3.5-flash",
    fetchImpl: async (input, init) => {
      assert.equal(
        String(input),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      );
      assert.equal(new Headers(init.headers).get("x-goog-api-key"), API_KEY);
      requestBody = JSON.parse(init.body);
      return jsonResponse({
        responseId: "response-1",
        candidates: [{
          content: {
            parts: [{ text: "根據收藏，這個做法能改善檢索。" }],
          },
          groundingMetadata: {
            groundingChunks: [{
              retrievedContext: {
                title: "檢索筆記",
                text: "混合檢索能兼顧精確字詞與語意。",
                uri: "https://generativelanguage.googleapis.com/fileSearchStores/store/documents/doc-1",
                fileSearchStore: "fileSearchStores/owner-library",
                pageNumber: 3,
                customMetadata: [
                  { key: "bookmark_id", stringValue: "bookmark-1" },
                  { key: "revision", stringValue: "revision-1" },
                ],
              },
            }],
            groundingSupports: [{
              segment: {
                text: "這個做法能改善檢索。",
                partIndex: 0,
                startIndex: 6,
                endIndex: 17,
              },
              groundingChunkIndices: [0],
              confidenceScores: [0.96],
            }],
          },
        }],
      });
    },
  });

  const result = await client.ask("怎麼改善資料檢索？", "fileSearchStores/owner-library");

  assert.equal(result.answer, "根據收藏，這個做法能改善檢索。");
  assert.equal(result.responseId, "response-1");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].metadata.bookmark_id, "bookmark-1");
  assert.equal(result.sources[0].metadata.revision, "revision-1");
  assert.equal(result.sources[0].pageNumber, 3);
  assert.equal(result.supports.length, 1);
  assert.equal(result.supports[0].claim, "這個做法能改善檢索。");
  assert.deepEqual(result.supports[0].confidenceScores, [0.96]);
  assert.equal(result.supports[0].sources[0], result.sources[0]);
  assert.deepEqual(requestBody.tools, [{
    fileSearch: {
      fileSearchStoreNames: ["fileSearchStores/owner-library"],
      topK: 10,
    },
  }]);
  assert.match(requestBody.contents[0].parts[0].text, /Question: 怎麼改善資料檢索？/);
});

test("rejects untrusted resumable URLs and redacts upstream error bodies", async () => {
  let calls = 0;
  const unsafeClient = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({}, {
        headers: { "x-goog-upload-url": "https://attacker.example/steal" },
      });
    },
  });
  await assert.rejects(
    unsafeClient.uploadDocument({
      storeName: "fileSearchStores/owner-library",
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
      displayName: "source.pdf",
      metadata: {},
    }),
    (error) => error instanceof GeminiFileSearchError &&
      error.code === "invalid_response" &&
      !error.message.includes("attacker.example"),
  );
  assert.equal(calls, 1);

  const authClient = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse({
      error: { status: "PERMISSION_DENIED", message: "secret diagnostic" },
    }, { status: 403 }),
  });
  await assert.rejects(
    authClient.createStore("library"),
    (error) => error instanceof GeminiFileSearchError &&
      error.code === "authentication_failed" &&
      error.status === 403 &&
      !error.message.includes("secret diagnostic"),
  );

  const rejectedClient = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse({
      error: {
        status: "INVALID_ARGUMENT",
        message: `secret diagnostic ${API_KEY}`,
        details: [{ reason: "AUTHORIZATION_KEY_TYPE_UNSUPPORTED" }],
      },
    }, { status: 400 }),
  });
  await assert.rejects(
    rejectedClient.createStore("library"),
    (error) => error instanceof GeminiFileSearchError &&
      error.code === "request_rejected" &&
      error.message.includes("INVALID_ARGUMENT") &&
      error.message.includes("AUTHORIZATION_KEY_TYPE_UNSUPPORTED") &&
      !error.message.includes(API_KEY) &&
      !error.message.includes("secret diagnostic"),
  );
});

test("surfaces safe field violation paths without leaking upstream text", async () => {
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: `Invalid JSON payload ${API_KEY}`,
        details: [{
          "@type": "type.googleapis.com/google.rpc.BadRequest",
          fieldViolations: [
            { field: "file_search_store.display_name", description: "secret project detail" },
            { field: "../../etc/passwd", description: "must be ignored" },
          ],
        }],
      },
    }, { status: 400 }),
  });

  await assert.rejects(
    client.createStore("library"),
    (error) => error instanceof GeminiFileSearchError &&
      error.code === "request_rejected" &&
      error.status === 400 &&
      error.message.includes("INVALID_ARGUMENT") &&
      error.message.includes("field:file_search_store.display_name") &&
      !error.message.includes("etc/passwd") &&
      !error.message.includes("secret project detail") &&
      !error.message.includes(API_KEY),
  );
});

test("treats deleting an already-missing remote document as success", async () => {
  let call;
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      call = { input: String(input), init };
      return new Response("not found", { status: 404 });
    },
  });

  await client.deleteDocument("fileSearchStores/owner-library/documents/document-1");

  assert.equal(
    call.input,
    "https://generativelanguage.googleapis.com/v1beta/fileSearchStores/owner-library/documents/document-1?force=true",
  );
  assert.equal(call.init.method, "DELETE");
  assert.equal(new Headers(call.init.headers).get("x-goog-api-key"), API_KEY);
});

test("can safely clean up an orphaned File Search store", async () => {
  let call;
  const client = createGeminiFileSearchClient({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      call = { input: String(input), init };
      return new Response(null, { status: 204 });
    },
  });

  await client.deleteStore("fileSearchStores/orphaned-library");

  assert.equal(
    call.input,
    "https://generativelanguage.googleapis.com/v1beta/fileSearchStores/orphaned-library?force=true",
  );
  assert.equal(call.init.method, "DELETE");
  assert.equal(new Headers(call.init.headers).get("x-goog-api-key"), API_KEY);
});
