import assert from "node:assert/strict";
import test from "node:test";
import { probeGeminiApiKey } from "../lib/gemini-diagnostic.ts";

const API_KEY = "new-key-that-must-never-appear-in-a-url-or-result";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routeHealthyGemini(calls) {
  return async (input, init) => {
    const url = String(input);
    calls?.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (url.includes("/models?")) {
      return jsonResponse({
        models: [
          {
            name: "models/gemini-embedding-test",
            supportedGenerationMethods: ["embedContent"],
          },
          {
            name: "models/gemini-test-flash",
            supportedGenerationMethods: ["generateContent", "countTokens"],
          },
        ],
      });
    }
    if (url.includes("/fileSearchStores?")) {
      return jsonResponse({
        fileSearchStores: [
          { name: "fileSearchStores/private-store-id", displayName: "bookmark-site-library" },
        ],
        nextPageToken: "next-page",
      });
    }
    if (url.includes(":countTokens")) {
      return jsonResponse({ totalTokens: 3 });
    }
    return jsonResponse({}, 404);
  };
}

test("probes models, stores, and a countTokens POST with the key only in a header", async () => {
  const calls = [];
  const result = await probeGeminiApiKey(API_KEY, routeHealthyGemini(calls), {
    storeDisplayName: "bookmark-site-library",
  });

  assert.deepEqual(result, {
    configured: true,
    credentialAccepted: true,
    fileSearchAccessible: true,
    keyFormat: "unknown",
    models: { ok: true, status: 200, upstreamStatus: null, category: "ok" },
    fileSearchStores: { ok: true, status: 200, upstreamStatus: null, category: "ok" },
    storeSummary: { count: 1, truncated: true, namedStorePresent: true },
    countTokensPost: { ok: true, status: 200, upstreamStatus: null, category: "ok" },
  });
  assert.deepEqual(calls.map((call) => call.url), [
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=50",
    "https://generativelanguage.googleapis.com/v1beta/fileSearchStores?pageSize=20",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-flash:countTokens",
  ]);
  const postCall = calls[2];
  assert.equal(postCall.method, "POST");
  assert.equal(postCall.headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(postCall.body), {
    contents: [{ parts: [{ text: "diagnostic ping" }] }],
  });
  for (const call of calls) {
    assert.equal(call.headers.get("x-goog-api-key"), API_KEY);
    assert.equal(call.url.includes(API_KEY), false);
    assert.equal((call.body ?? "").includes(API_KEY), false);
  }
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes("private-store-id"), false);
  assert.equal(serialized.includes("fileSearchStores/"), false);
});

test("classifies the configured key family without leaking key material", async () => {
  const authResult = await probeGeminiApiKey("AQ.fake-key-1234567890", routeHealthyGemini());
  assert.equal(authResult.keyFormat, "auth_key");
  assert.equal(JSON.stringify(authResult).includes("AQ.fake-key-1234567890"), false);

  const standardResult = await probeGeminiApiKey("AIzaFakeKeyForTests123", routeHealthyGemini());
  assert.equal(standardResult.keyFormat, "standard_key");
  assert.equal(JSON.stringify(standardResult).includes("AIzaFakeKeyForTests123"), false);
});

test("reports only bounded status metadata and never returns an upstream error message", async () => {
  let call = 0;
  const result = await probeGeminiApiKey(API_KEY, async () => {
    call += 1;
    return call === 1
      ? jsonResponse({
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: `secret=${API_KEY}`,
          details: [{ privateProject: "do-not-return" }],
        },
      }, 400)
      : jsonResponse({
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "private permission detail",
        },
      }, 403);
  });

  assert.deepEqual(result.models, {
    ok: false,
    status: 400,
    upstreamStatus: "INVALID_ARGUMENT",
    category: "invalid_request",
  });
  assert.deepEqual(result.fileSearchStores, {
    ok: false,
    status: 403,
    upstreamStatus: "PERMISSION_DENIED",
    category: "permission_denied",
  });
  assert.equal(result.storeSummary, null);
  assert.equal(result.countTokensPost, null);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes("private"), false);
});

test("surfaces a countTokens rejection as a bounded probe result", async () => {
  const calls = [];
  const result = await probeGeminiApiKey(API_KEY, async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/models?")) {
      return jsonResponse({
        models: [{
          name: "models/gemini-test-flash",
          supportedGenerationMethods: ["generateContent", "countTokens"],
        }],
      });
    }
    if (url.includes(":countTokens")) {
      assert.equal(init?.method, "POST");
      return jsonResponse({
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: "private validation detail",
        },
      }, 400);
    }
    return jsonResponse({});
  });

  assert.equal(calls[2], "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-flash:countTokens");
  assert.deepEqual(result.countTokensPost, {
    ok: false,
    status: 400,
    upstreamStatus: "INVALID_ARGUMENT",
    category: "invalid_request",
  });
  assert.equal(JSON.stringify(result).includes("private validation detail"), false);
});

test("skips the POST probe when no listed model supports countTokens", async () => {
  const calls = [];
  const result = await probeGeminiApiKey(API_KEY, async (input) => {
    calls.push(String(input));
    if (String(input).includes("/models?")) {
      return jsonResponse({
        models: [{
          name: "models/gemini-embedding-test",
          supportedGenerationMethods: ["embedContent"],
        }],
      });
    }
    return jsonResponse({});
  });

  assert.equal(calls.length, 2);
  assert.equal(result.countTokensPost, null);
  assert.deepEqual(result.storeSummary, {
    count: 0,
    truncated: false,
    namedStorePresent: false,
  });
});

test("separates network failures from upstream HTTP failures", async () => {
  const result = await probeGeminiApiKey(API_KEY, async (input) => {
    if (String(input).includes("/models?")) throw new Error("network includes secret");
    return new Response("not-json", { status: 502 });
  });

  assert.deepEqual(result.models, {
    ok: false,
    status: null,
    upstreamStatus: null,
    category: "network_error",
  });
  assert.deepEqual(result.fileSearchStores, {
    ok: false,
    status: 502,
    upstreamStatus: null,
    category: "upstream_failure",
  });
  assert.equal(result.storeSummary, null);
  assert.equal(result.countTokensPost, null);
});
