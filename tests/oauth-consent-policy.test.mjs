import assert from "node:assert/strict";
import test from "node:test";
import {
  OAUTH_CONSENT_CONTENT_SECURITY_POLICY,
  OAUTH_REDIRECT_FORM_ACTION_SOURCES,
} from "../lib/oauth-consent-policy.ts";

test("OAuth consent allows only the supported authorization callback origins", () => {
  assert.deepEqual(OAUTH_REDIRECT_FORM_ACTION_SOURCES, [
    "'self'",
    "http://127.0.0.1:*",
    "http://localhost:*",
    "http://[::1]:*",
    "https://chatgpt.com",
    "https://claude.ai",
  ]);

  const formAction = OAUTH_CONSENT_CONTENT_SECURITY_POLICY
    .split("; ")
    .find((directive) => directive.startsWith("form-action "));
  assert.equal(
    formAction,
    `form-action ${OAUTH_REDIRECT_FORM_ACTION_SOURCES.join(" ")}`,
  );
});

test("OAuth consent keeps the rest of the page locked down", () => {
  for (const directive of [
    "default-src 'none'",
    "connect-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.match(OAUTH_CONSENT_CONTENT_SECURITY_POLICY, new RegExp(directive));
  }
});
