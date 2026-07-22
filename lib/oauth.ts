import { env } from "cloudflare:workers";
import { OAUTH_CONSENT_CONTENT_SECURITY_POLICY } from "@/lib/oauth-consent-policy";

export const KNOWLEDGE_SCOPE = "knowledge:read";
export const OAUTH_ACCESS_TOKEN_PREFIX = "relay_oat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "relay_ort_";

const AUTHORIZATION_REQUEST_PREFIX = "relay_oar_";
const AUTHORIZATION_CODE_PREFIX = "relay_oac_";
const OAUTH_CLIENT_PREFIX = "relay_client_";
const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1_000;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const AUTHORIZATION_REQUEST_LIFETIME_MS = 10 * 60 * 1_000;
const AUTHORIZATION_CODE_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_REQUEST_BODY_BYTES = 16_384;
const MAX_AUTHORIZATION_URL_LENGTH = 8_192;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

const CONSENT_HEADERS = {
  ...NO_STORE_HEADERS,
  "Content-Security-Policy": OAUTH_CONSENT_CONTENT_SECURITY_POLICY,
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
} as const;

type OauthClientRow = {
  client_id: string;
  client_name: string;
  client_uri: string | null;
  redirect_uris: string;
  revoked_at: string | null;
};

type AuthorizationRequestRow = {
  owner_email: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  resource: string;
  scope: string;
  code_challenge: string;
};

type AuthorizationCodeRow = AuthorizationRequestRow & {
  code_hash: string;
  expires_at: string;
  consumed_at: string | null;
};

type RefreshTokenRow = {
  token_hash: string;
  family_id: string;
  owner_email: string;
  client_id: string;
  resource: string;
  scope: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  family_revoked_at: string | null;
  family_expires_at: string;
};

type AccessTokenRow = {
  token_hash: string;
  family_id: string;
  owner_email: string;
  client_id: string;
  resource: string;
  scope: string;
  expires_at: string;
  revoked_at: string | null;
};

export type OauthConsent = {
  transaction: string;
  clientName: string;
  redirectHost: string;
  scope: string;
  loopbackRedirect: boolean;
};

export type OauthAccessContext = {
  clientId: string;
  ownerEmail: string;
  resource: string;
  scopes: string[];
  tokenHash: string;
};

export type OauthConnectionView = {
  clientId: string;
  clientName: string;
  redirectHost: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export class OAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export function canonicalOauthOrigin(request: Request): string {
  const url = new URL(request.url);
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLocalHostname(url.hostname)) return url.origin;
  throw new OAuthError(400, "invalid_request", "OAuth endpoints require HTTPS.");
}

export function canonicalMcpResource(request: Request): string {
  return `${canonicalOauthOrigin(request)}/mcp`;
}

export function protectedResourceMetadata(request: Request) {
  const origin = canonicalOauthOrigin(request);
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [KNOWLEDGE_SCOPE],
    resource_documentation: `${origin}/`,
  };
}

export function authorizationServerMetadata(request: Request) {
  const origin = canonicalOauthOrigin(request);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [KNOWLEDGE_SCOPE],
  };
}

export async function registerOauthClient(request: Request): Promise<Response> {
  await consumeRateLimit(request, "register", 30, 60 * 60 * 1_000);
  requireContentType(request, "application/json");
  const payload = parseJsonObject(await readLimitedText(request));
  const redirectUris = normalizeRegistrationRedirects(payload.redirect_uris);
  const grantTypes = normalizeStringArray(
    payload.grant_types,
    ["authorization_code", "refresh_token"],
    ["authorization_code", "refresh_token"],
    "grant_types",
  );
  if (!grantTypes.includes("authorization_code")) {
    throw new OAuthError(400, "invalid_client_metadata", "authorization_code is required.");
  }
  const responseTypes = normalizeStringArray(
    payload.response_types,
    ["code"],
    ["code"],
    "response_types",
  );
  if (!responseTypes.includes("code")) {
    throw new OAuthError(400, "invalid_client_metadata", "The code response type is required.");
  }
  const tokenEndpointAuthMethod = payload.token_endpoint_auth_method ?? "none";
  if (tokenEndpointAuthMethod !== "none") {
    throw new OAuthError(
      400,
      "invalid_client_metadata",
      "Only public clients using token_endpoint_auth_method=none are supported.",
    );
  }

  const clientName = normalizeDisplayText(payload.client_name, "MCP client", 100);
  const clientUri = normalizeClientUri(payload.client_uri);
  const clientId = randomOpaqueToken(OAUTH_CLIENT_PREFIX);
  const now = new Date();
  const nowIso = now.toISOString();

  await getD1().prepare(`
    INSERT INTO oauth_clients (
      client_id, client_name, client_uri, redirect_uris, grant_types,
      response_types, token_endpoint_auth_method, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'none', ?)
  `).bind(
    clientId,
    clientName,
    clientUri,
    JSON.stringify(redirectUris),
    JSON.stringify(grantTypes),
    JSON.stringify(responseTypes),
    nowIso,
  ).run();

  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1_000),
      client_name: clientName,
      client_uri: clientUri ?? undefined,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: "none",
      scope: KNOWLEDGE_SCOPE,
    },
    { status: 201, headers: NO_STORE_HEADERS },
  );
}

export function authorizedOwnerEmail(request: Request): string {
  const configuredOwner = configuredOwnerEmail();
  const forwardedOwner = normalizeEmail(
    request.headers.get("oai-authenticated-user-email") ?? "",
  );
  if (forwardedOwner && constantTimeEquals(configuredOwner, forwardedOwner)) {
    return configuredOwner;
  }

  const url = new URL(request.url);
  if (process.env.NODE_ENV === "development" && isLocalHostname(url.hostname)) {
    return configuredOwner;
  }
  throw new OAuthError(403, "access_denied", "Only the Site owner may authorize access.");
}

export async function beginAuthorization(
  request: Request,
  ownerEmail: string,
): Promise<OauthConsent> {
  if (request.url.length > MAX_AUTHORIZATION_URL_LENGTH) {
    throw new OAuthError(400, "invalid_request", "The authorization request is too long.");
  }
  const url = new URL(request.url);
  const responseType = singleSearchParam(url.searchParams, "response_type", true);
  const clientId = boundedParam(
    singleSearchParam(url.searchParams, "client_id", true),
    "client_id",
    256,
  );
  const redirectUri = boundedParam(
    singleSearchParam(url.searchParams, "redirect_uri", true),
    "redirect_uri",
    2_048,
  );
  const resource = boundedParam(
    singleSearchParam(url.searchParams, "resource", true),
    "resource",
    2_048,
  );
  const scope = normalizeScope(singleSearchParam(url.searchParams, "scope", false));
  const state = boundedOptionalParam(
    singleSearchParam(url.searchParams, "state", false),
    "state",
    1_024,
  );
  const codeChallenge = boundedParam(
    singleSearchParam(url.searchParams, "code_challenge", true),
    "code_challenge",
    128,
  );
  const codeChallengeMethod = singleSearchParam(
    url.searchParams,
    "code_challenge_method",
    true,
  );

  if (responseType !== "code") {
    throw new OAuthError(400, "unsupported_response_type", "Only response_type=code is supported.");
  }
  if (codeChallengeMethod !== "S256" || !isS256Challenge(codeChallenge)) {
    throw new OAuthError(400, "invalid_request", "A valid S256 PKCE challenge is required.");
  }
  if (resource !== canonicalMcpResource(request)) {
    throw new OAuthError(400, "invalid_target", "The requested MCP resource is invalid.");
  }

  const client = await getOauthClient(clientId);
  if (!client) throw new OAuthError(400, "invalid_request", "The OAuth client is not registered.");
  const registeredRedirects = parseStoredRedirects(client.redirect_uris);
  if (!isSafeRedirectUri(redirectUri) || !redirectMatchesRegistered(redirectUri, registeredRedirects)) {
    // Never redirect an error until the redirect URI has been proven to belong to the client.
    throw new OAuthError(400, "invalid_request", "The redirect URI is not registered.");
  }

  const transaction = randomOpaqueToken(AUTHORIZATION_REQUEST_PREFIX);
  const transactionHash = await sha256Hex(transaction);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTHORIZATION_REQUEST_LIFETIME_MS).toISOString();
  await getD1().prepare(`
    INSERT INTO oauth_authorization_requests (
      transaction_hash, owner_email, client_id, redirect_uri, state, resource,
      scope, code_challenge, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    transactionHash,
    normalizeEmail(ownerEmail),
    client.client_id,
    redirectUri,
    state,
    resource,
    scope,
    codeChallenge,
    expiresAt,
    now.toISOString(),
  ).run();

  const redirectUrl = new URL(redirectUri);
  return {
    transaction,
    clientName: client.client_name,
    redirectHost: redirectUrl.host,
    scope,
    loopbackRedirect: isLoopbackRedirect(redirectUrl),
  };
}

export async function completeAuthorization(
  request: Request,
  ownerEmail: string,
): Promise<Response> {
  requireContentType(request, "application/x-www-form-urlencoded");
  const form = new URLSearchParams(await readLimitedText(request));
  const transaction = boundedParam(
    singleSearchParam(form, "transaction", true),
    "transaction",
    128,
  );
  const decision = singleSearchParam(form, "decision", true);
  if (decision !== "approve" && decision !== "deny") {
    throw new OAuthError(400, "invalid_request", "Choose whether to allow access.");
  }
  if (!isOpaqueToken(transaction, AUTHORIZATION_REQUEST_PREFIX)) {
    throw new OAuthError(400, "invalid_request", "The authorization request is invalid.");
  }

  const transactionHash = await sha256Hex(transaction);
  const nowIso = new Date().toISOString();
  const row = await getD1().prepare(`
    UPDATE oauth_authorization_requests
    SET consumed_at = ?, decision = ?
    WHERE transaction_hash = ?
      AND owner_email = ?
      AND consumed_at IS NULL
      AND expires_at > ?
    RETURNING owner_email, client_id, redirect_uri, state, resource, scope, code_challenge
  `).bind(
    nowIso,
    decision,
    transactionHash,
    normalizeEmail(ownerEmail),
    nowIso,
  ).first<AuthorizationRequestRow>();

  if (!row) {
    throw new OAuthError(400, "invalid_request", "This authorization request expired or was already used.");
  }

  await getD1().prepare(
    "UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ? AND revoked_at IS NULL",
  ).bind(nowIso, row.client_id).run();

  if (decision === "deny") {
    return authorizationRedirect(row.redirect_uri, {
      error: "access_denied",
      error_description: "The Site owner declined access.",
      state: row.state,
    });
  }

  const code = randomOpaqueToken(AUTHORIZATION_CODE_PREFIX);
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_LIFETIME_MS).toISOString();
  await getD1().prepare(`
    INSERT INTO oauth_authorization_codes (
      code_hash, owner_email, client_id, redirect_uri, resource, scope,
      code_challenge, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    codeHash,
    row.owner_email,
    row.client_id,
    row.redirect_uri,
    row.resource,
    row.scope,
    row.code_challenge,
    expiresAt,
    nowIso,
  ).run();

  return authorizationRedirect(row.redirect_uri, { code, state: row.state });
}

export async function exchangeOauthToken(request: Request): Promise<Response> {
  await consumeRateLimit(request, "token", 120, 60 * 60 * 1_000);
  requireContentType(request, "application/x-www-form-urlencoded");
  if (request.headers.has("authorization")) {
    throw new OAuthError(401, "invalid_client", "This server accepts public OAuth clients only.");
  }
  const form = new URLSearchParams(await readLimitedText(request));
  const grantType = singleSearchParam(form, "grant_type", true);
  const clientId = boundedParam(
    singleSearchParam(form, "client_id", true),
    "client_id",
    256,
  );
  const resource = boundedParam(
    singleSearchParam(form, "resource", true),
    "resource",
    2_048,
  );
  if (resource !== canonicalMcpResource(request)) {
    throw new OAuthError(400, "invalid_target", "The requested MCP resource is invalid.");
  }
  if (!await getOauthClient(clientId)) {
    throw new OAuthError(401, "invalid_client", "The OAuth client is invalid or revoked.");
  }

  if (grantType === "authorization_code") {
    return exchangeAuthorizationCode(form, clientId, resource);
  }
  if (grantType === "refresh_token") {
    return rotateRefreshToken(form, clientId, resource);
  }
  throw new OAuthError(400, "unsupported_grant_type", "This OAuth grant type is not supported.");
}

export async function revokeOauthToken(request: Request): Promise<Response> {
  await consumeRateLimit(request, "revoke", 120, 60 * 60 * 1_000);
  requireContentType(request, "application/x-www-form-urlencoded");
  const form = new URLSearchParams(await readLimitedText(request));
  const token = boundedParam(singleSearchParam(form, "token", true), "token", 128);
  const nowIso = new Date().toISOString();

  if (isOpaqueToken(token, OAUTH_ACCESS_TOKEN_PREFIX)) {
    await getD1().prepare(`
      UPDATE oauth_access_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE token_hash = ?
    `).bind(nowIso, await sha256Hex(token)).run();
  } else if (isOpaqueToken(token, OAUTH_REFRESH_TOKEN_PREFIX)) {
    const row = await getD1().prepare(
      "SELECT family_id FROM oauth_refresh_tokens WHERE token_hash = ? LIMIT 1",
    ).bind(await sha256Hex(token)).first<{ family_id: string }>();
    if (row) await revokeTokenFamily(row.family_id, nowIso);
  }

  // RFC 7009 revocation does not reveal whether the token existed.
  return new Response(null, { status: 200, headers: NO_STORE_HEADERS });
}

export async function listOauthConnections(): Promise<OauthConnectionView[]> {
  const ownerEmail = configuredOwnerEmail();
  const rows = await getD1().prepare(`
    SELECT client.client_id, client.client_name, client.redirect_uris,
      client.created_at, client.last_used_at
    FROM oauth_clients AS client
    WHERE client.revoked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM oauth_token_families AS family
        WHERE family.client_id = client.client_id
          AND family.owner_email = ?
          AND family.revoked_at IS NULL
          AND family.expires_at > ?
      )
    ORDER BY coalesce(client.last_used_at, client.created_at) DESC
    LIMIT 50
  `).bind(ownerEmail, new Date().toISOString()).all<{
    client_id: string;
    client_name: string;
    redirect_uris: string;
    created_at: string;
    last_used_at: string | null;
  }>();

  return rows.results.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    redirectHost: redirectHostFromStoredUris(row.redirect_uris),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

export async function revokeOauthConnection(clientId: string): Promise<void> {
  const normalizedClientId = clientId.trim();
  if (!isOpaqueToken(normalizedClientId, OAUTH_CLIENT_PREFIX)) {
    throw new OAuthError(400, "invalid_request", "A valid OAuth connection id is required.");
  }
  const ownerEmail = configuredOwnerEmail();
  const owned = await getD1().prepare(`
    SELECT family_id FROM oauth_token_families
    WHERE client_id = ? AND owner_email = ?
    LIMIT 1
  `).bind(normalizedClientId, ownerEmail).first<{ family_id: string }>();
  if (!owned) {
    throw new OAuthError(404, "invalid_request", "OAuth connection not found.");
  }

  const nowIso = new Date().toISOString();
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`
      UPDATE oauth_clients
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE client_id = ?
    `).bind(nowIso, normalizedClientId),
    d1.prepare(`
      UPDATE oauth_token_families
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE client_id = ? AND owner_email = ?
    `).bind(nowIso, normalizedClientId, ownerEmail),
    d1.prepare(`
      UPDATE oauth_access_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE client_id = ? AND owner_email = ?
    `).bind(nowIso, normalizedClientId, ownerEmail),
    d1.prepare(`
      UPDATE oauth_refresh_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE client_id = ? AND owner_email = ?
    `).bind(nowIso, normalizedClientId, ownerEmail),
  ]);
}

/**
 * Authenticates only app-issued OAuth access tokens. It intentionally never
 * reads SIWC headers, Site cookies, capture tokens, or refresh tokens.
 */
export async function authenticateOauthAccessToken(
  request: Request,
): Promise<OauthAccessContext> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? "";
  if (!isOpaqueToken(token, OAUTH_ACCESS_TOKEN_PREFIX)) {
    throw resourceAuthError(request, 401, "invalid_token", "A valid access token is required.");
  }

  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const row = await getD1().prepare(`
    SELECT access.token_hash, access.family_id, access.owner_email,
      access.client_id, access.resource, access.scope, access.expires_at,
      access.revoked_at
    FROM oauth_access_tokens AS access
    INNER JOIN oauth_token_families AS family
      ON family.family_id = access.family_id
    INNER JOIN oauth_clients AS client
      ON client.client_id = access.client_id
    WHERE access.token_hash = ?
      AND family.revoked_at IS NULL
      AND family.expires_at > ?
      AND client.revoked_at IS NULL
    LIMIT 1
  `).bind(tokenHash, nowIso).first<AccessTokenRow>();
  const ownerEmail = configuredOwnerEmail();
  if (
    !row || row.revoked_at || row.expires_at <= nowIso ||
    !constantTimeEquals(normalizeEmail(row.owner_email), ownerEmail) ||
    row.resource !== canonicalMcpResource(request)
  ) {
    throw resourceAuthError(request, 401, "invalid_token", "The access token is invalid or expired.");
  }

  const scopes = parseScope(row.scope);
  if (!scopes.includes(KNOWLEDGE_SCOPE)) {
    throw resourceAuthError(request, 403, "insufficient_scope", "knowledge:read is required.");
  }

  await getD1().prepare(
    "UPDATE oauth_access_tokens SET last_used_at = ? WHERE token_hash = ?",
  ).bind(nowIso, tokenHash).run();
  return {
    clientId: row.client_id,
    ownerEmail,
    resource: row.resource,
    scopes,
    tokenHash,
  };
}

export function oauthResourceErrorResponse(
  request: Request,
  error?: unknown,
): Response {
  const oauthError = error instanceof OAuthError
    ? error
    : resourceAuthError(request, 401, "invalid_token", "A valid access token is required.");
  return Response.json(
    { error: oauthError.code, error_description: oauthError.message },
    {
      status: oauthError.status,
      headers: { ...NO_STORE_HEADERS, ...oauthError.headers },
    },
  );
}

export function oauthErrorResponse(error: unknown): Response {
  const oauthError = error instanceof OAuthError
    ? error
    : new OAuthError(500, "server_error", "The OAuth request could not be completed.");
  return Response.json(
    { error: oauthError.code, error_description: oauthError.message },
    {
      status: oauthError.status,
      headers: { ...NO_STORE_HEADERS, ...oauthError.headers },
    },
  );
}

export function consentPageResponse(consent: OauthConsent): Response {
  const warning = consent.loopbackRedirect
    ? `<p class="warning">這個程式會把授權結果送回你電腦上的 ${escapeHtml(consent.redirectHost)}。只在你剛主動連線時允許。</p>`
    : "";
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>允許 AI 讀取中轉站</title><style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif}body{margin:0;background:#f4f5f7;color:#17191d}main{max-width:560px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #dfe2e7;border-radius:18px}h1{margin:0 0 12px;font-size:1.65rem}p{line-height:1.6;color:#4b5260}.facts{margin:24px 0;padding:16px;background:#f5f7fa;border-radius:12px}.facts p{margin:4px 0}.warning{color:#8b4b00}form{display:flex;gap:10px;flex-wrap:wrap}button{min-height:44px;padding:0 18px;border-radius:10px;border:1px solid #b8bec8;font:inherit;font-weight:700;cursor:pointer}.approve{background:#274f8c;color:#fff;border-color:#274f8c}.deny{background:#fff;color:#333}@media(prefers-color-scheme:dark){body{background:#111318;color:#f2f3f5}main{background:#1b1e24;border-color:#343944}p{color:#c2c7d0}.facts{background:#242832}.deny{background:#1b1e24;color:#f2f3f5}.warning{color:#ffbd66}}</style></head>
<body><main><h1>允許 AI 讀取中轉站？</h1><p>你正在授權 <strong>${escapeHtml(consent.clientName)}</strong> 讀取你已儲存的網頁資訊。</p>
<div class="facts"><p><strong>權限：</strong>唯讀搜尋與閱讀</p><p><strong>範圍：</strong>${escapeHtml(consent.scope)}</p><p><strong>授權結果送往：</strong>${escapeHtml(consent.redirectHost)}</p></div>${warning}
<p>它不能新增、修改或刪除收藏，也拿不到你的 ChatGPT 登入狀態。</p>
<form method="post" action="/oauth/authorize"><input type="hidden" name="transaction" value="${escapeHtml(consent.transaction)}">
<button class="approve" name="decision" value="approve" type="submit">允許唯讀存取</button><button class="deny" name="decision" value="deny" type="submit">取消</button></form></main></body></html>`;
  return new Response(html, { status: 200, headers: CONSENT_HEADERS });
}

export function consentErrorResponse(error: unknown): Response {
  const oauthError = error instanceof OAuthError
    ? error
    : new OAuthError(500, "server_error", "The authorization request could not be completed.");
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>無法授權</title><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:620px;margin:12vh auto;padding:24px;line-height:1.6}code{word-break:break-word}</style></head><body><h1>無法完成授權</h1><p>${escapeHtml(oauthError.message)}</p><p><code>${escapeHtml(oauthError.code)}</code></p></body></html>`;
  return new Response(html, { status: oauthError.status, headers: CONSENT_HEADERS });
}

async function exchangeAuthorizationCode(
  form: URLSearchParams,
  clientId: string,
  resource: string,
): Promise<Response> {
  const code = boundedParam(singleSearchParam(form, "code", true), "code", 128);
  const redirectUri = boundedParam(
    singleSearchParam(form, "redirect_uri", true),
    "redirect_uri",
    2_048,
  );
  const verifier = boundedParam(
    singleSearchParam(form, "code_verifier", true),
    "code_verifier",
    128,
  );
  if (!isOpaqueToken(code, AUTHORIZATION_CODE_PREFIX) || !isPkceVerifier(verifier)) {
    throw invalidGrant();
  }

  const codeHash = await sha256Hex(code);
  const row = await getD1().prepare(`
    SELECT code_hash, owner_email, client_id, redirect_uri, resource, scope,
      code_challenge, expires_at, consumed_at
    FROM oauth_authorization_codes
    WHERE code_hash = ?
    LIMIT 1
  `).bind(codeHash).first<AuthorizationCodeRow>();
  const nowIso = new Date().toISOString();
  if (
    !row || row.consumed_at || row.expires_at <= nowIso ||
    row.client_id !== clientId || row.redirect_uri !== redirectUri ||
    row.resource !== resource ||
    !constantTimeEquals(normalizeEmail(row.owner_email), configuredOwnerEmail()) ||
    !constantTimeEquals(await pkceChallenge(verifier), row.code_challenge)
  ) {
    throw invalidGrant();
  }

  const consumed = await getD1().prepare(`
    UPDATE oauth_authorization_codes
    SET consumed_at = ?
    WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
    RETURNING code_hash
  `).bind(nowIso, codeHash, nowIso).first<{ code_hash: string }>();
  if (!consumed) throw invalidGrant();

  return issueTokenPair({
    ownerEmail: row.owner_email,
    clientId,
    resource,
    scope: row.scope,
    familyId: crypto.randomUUID(),
    createFamily: true,
  });
}

async function rotateRefreshToken(
  form: URLSearchParams,
  clientId: string,
  resource: string,
): Promise<Response> {
  const refreshToken = boundedParam(
    singleSearchParam(form, "refresh_token", true),
    "refresh_token",
    128,
  );
  if (!isOpaqueToken(refreshToken, OAUTH_REFRESH_TOKEN_PREFIX)) throw invalidGrant();
  const requestedScope = singleSearchParam(form, "scope", false);
  const tokenHash = await sha256Hex(refreshToken);
  const row = await getD1().prepare(`
    SELECT refresh.token_hash, refresh.family_id, refresh.owner_email,
      refresh.client_id, refresh.resource, refresh.scope, refresh.expires_at,
      refresh.consumed_at, refresh.revoked_at,
      family.revoked_at AS family_revoked_at,
      family.expires_at AS family_expires_at
    FROM oauth_refresh_tokens AS refresh
    INNER JOIN oauth_token_families AS family
      ON family.family_id = refresh.family_id
    WHERE refresh.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first<RefreshTokenRow>();
  const nowIso = new Date().toISOString();

  if (row?.consumed_at) {
    await revokeTokenFamily(row.family_id, nowIso);
    throw invalidGrant();
  }
  if (
    !row || row.revoked_at || row.family_revoked_at ||
    row.expires_at <= nowIso || row.family_expires_at <= nowIso ||
    row.client_id !== clientId || row.resource !== resource ||
    !constantTimeEquals(normalizeEmail(row.owner_email), configuredOwnerEmail())
  ) {
    throw invalidGrant();
  }
  if (requestedScope !== null && normalizeScope(requestedScope) !== row.scope) {
    throw new OAuthError(400, "invalid_scope", "A refresh request cannot expand its scope.");
  }

  const consumed = await getD1().prepare(`
    UPDATE oauth_refresh_tokens
    SET consumed_at = ?
    WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    RETURNING token_hash
  `).bind(nowIso, tokenHash, nowIso).first<{ token_hash: string }>();
  if (!consumed) {
    await revokeTokenFamily(row.family_id, nowIso);
    throw invalidGrant();
  }

  return issueTokenPair({
    ownerEmail: row.owner_email,
    clientId,
    resource,
    scope: row.scope,
    familyId: row.family_id,
    createFamily: false,
    familyExpiresAt: row.family_expires_at,
  });
}

async function issueTokenPair(input: {
  ownerEmail: string;
  clientId: string;
  resource: string;
  scope: string;
  familyId: string;
  createFamily: boolean;
  familyExpiresAt?: string;
}): Promise<Response> {
  const accessToken = randomOpaqueToken(OAUTH_ACCESS_TOKEN_PREFIX);
  const refreshToken = randomOpaqueToken(OAUTH_REFRESH_TOKEN_PREFIX);
  const [accessHash, refreshHash] = await Promise.all([
    sha256Hex(accessToken),
    sha256Hex(refreshToken),
  ]);
  const now = new Date();
  const nowIso = now.toISOString();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_LIFETIME_MS).toISOString();
  const refreshExpiresAt = input.familyExpiresAt ??
    new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS).toISOString();
  const d1 = getD1();
  const ownerEmail = normalizeEmail(input.ownerEmail);
  if (input.createFamily) {
    await d1.batch([
      d1.prepare(`
        INSERT INTO oauth_token_families (
          family_id, owner_email, client_id, resource, scope, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        input.familyId,
        ownerEmail,
        input.clientId,
        input.resource,
        input.scope,
        refreshExpiresAt,
        nowIso,
      ),
      accessTokenInsert(d1, {
        tokenHash: accessHash,
        token: accessToken,
        familyId: input.familyId,
        ownerEmail,
        clientId: input.clientId,
        resource: input.resource,
        scope: input.scope,
        expiresAt: accessExpiresAt,
        createdAt: nowIso,
        conditional: false,
      }),
      refreshTokenInsert(d1, {
        tokenHash: refreshHash,
        token: refreshToken,
        familyId: input.familyId,
        ownerEmail,
        clientId: input.clientId,
        resource: input.resource,
        scope: input.scope,
        expiresAt: refreshExpiresAt,
        createdAt: nowIso,
        conditional: false,
      }),
      d1.prepare(
        "UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ? AND revoked_at IS NULL",
      ).bind(nowIso, input.clientId),
    ]);
  } else {
    const results = await d1.batch([
      accessTokenInsert(d1, {
        tokenHash: accessHash,
        token: accessToken,
        familyId: input.familyId,
        ownerEmail,
        clientId: input.clientId,
        resource: input.resource,
        scope: input.scope,
        expiresAt: accessExpiresAt,
        createdAt: nowIso,
        conditional: true,
      }),
      refreshTokenInsert(d1, {
        tokenHash: refreshHash,
        token: refreshToken,
        familyId: input.familyId,
        ownerEmail,
        clientId: input.clientId,
        resource: input.resource,
        scope: input.scope,
        expiresAt: refreshExpiresAt,
        createdAt: nowIso,
        conditional: true,
      }),
      d1.prepare(
        "UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ? AND revoked_at IS NULL",
      ).bind(nowIso, input.clientId),
    ]);
    if (d1Changes(results[0]) !== 1 || d1Changes(results[1]) !== 1) {
      throw invalidGrant();
    }
  }

  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_LIFETIME_MS / 1_000),
      refresh_token: refreshToken,
      scope: input.scope,
    },
    { headers: NO_STORE_HEADERS },
  );
}

type TokenInsertInput = {
  tokenHash: string;
  token: string;
  familyId: string;
  ownerEmail: string;
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: string;
  createdAt: string;
  conditional: boolean;
};

function accessTokenInsert(
  d1: D1Database,
  input: TokenInsertInput,
): D1PreparedStatement {
  if (!input.conditional) {
    return d1.prepare(`
      INSERT INTO oauth_access_tokens (
        token_hash, token_hint, family_id, owner_email, client_id, resource,
        scope, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tokenHash,
      tokenHint(input.token),
      input.familyId,
      input.ownerEmail,
      input.clientId,
      input.resource,
      input.scope,
      input.expiresAt,
      input.createdAt,
    );
  }
  return d1.prepare(`
    INSERT INTO oauth_access_tokens (
      token_hash, token_hint, family_id, owner_email, client_id, resource,
      scope, expires_at, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM oauth_token_families
    WHERE family_id = ? AND owner_email = ? AND client_id = ?
      AND resource = ? AND scope = ?
      AND revoked_at IS NULL AND expires_at > ?
  `).bind(
    input.tokenHash,
    tokenHint(input.token),
    input.familyId,
    input.ownerEmail,
    input.clientId,
    input.resource,
    input.scope,
    input.expiresAt,
    input.createdAt,
    input.familyId,
    input.ownerEmail,
    input.clientId,
    input.resource,
    input.scope,
    input.createdAt,
  );
}

function refreshTokenInsert(
  d1: D1Database,
  input: TokenInsertInput,
): D1PreparedStatement {
  if (!input.conditional) {
    return d1.prepare(`
      INSERT INTO oauth_refresh_tokens (
        token_hash, token_hint, family_id, owner_email, client_id, resource,
        scope, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tokenHash,
      tokenHint(input.token),
      input.familyId,
      input.ownerEmail,
      input.clientId,
      input.resource,
      input.scope,
      input.expiresAt,
      input.createdAt,
    );
  }
  return d1.prepare(`
    INSERT INTO oauth_refresh_tokens (
      token_hash, token_hint, family_id, owner_email, client_id, resource,
      scope, expires_at, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM oauth_token_families
    WHERE family_id = ? AND owner_email = ? AND client_id = ?
      AND resource = ? AND scope = ?
      AND revoked_at IS NULL AND expires_at > ?
  `).bind(
    input.tokenHash,
    tokenHint(input.token),
    input.familyId,
    input.ownerEmail,
    input.clientId,
    input.resource,
    input.scope,
    input.expiresAt,
    input.createdAt,
    input.familyId,
    input.ownerEmail,
    input.clientId,
    input.resource,
    input.scope,
    input.createdAt,
  );
}

function d1Changes(result: D1Result<unknown> | undefined): number {
  const value = result?.meta?.changes;
  return typeof value === "number" ? value : Number(value ?? 0);
}

async function revokeTokenFamily(familyId: string, nowIso: string): Promise<void> {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`
      UPDATE oauth_token_families
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE family_id = ?
    `).bind(nowIso, familyId),
    d1.prepare(`
      UPDATE oauth_refresh_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE family_id = ?
    `).bind(nowIso, familyId),
    d1.prepare(`
      UPDATE oauth_access_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE family_id = ?
    `).bind(nowIso, familyId),
  ]);
}

async function getOauthClient(clientId: string): Promise<OauthClientRow | null> {
  return getD1().prepare(`
    SELECT client_id, client_name, client_uri, redirect_uris, revoked_at
    FROM oauth_clients
    WHERE client_id = ? AND revoked_at IS NULL
    LIMIT 1
  `).bind(clientId).first<OauthClientRow>();
}

function normalizeRegistrationRedirects(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new OAuthError(400, "invalid_redirect_uri", "Provide between 1 and 10 redirect URIs.");
  }
  const redirects = Array.from(new Set(value.map((item) => {
    if (typeof item !== "string" || item.length > 2_048 || !isSafeRedirectUri(item)) {
      throw new OAuthError(400, "invalid_redirect_uri", "A redirect URI is not allowed.");
    }
    return item;
  })));
  if (!redirects.length) {
    throw new OAuthError(400, "invalid_redirect_uri", "At least one redirect URI is required.");
  }
  return redirects;
}

function isSafeRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash || url.search) return false;

  if (url.protocol === "https:" && url.hostname === "chatgpt.com") {
    return /^\/connector\/oauth\/[A-Za-z0-9._~-]+\/?$/.test(url.pathname) ||
      url.pathname === "/connector_platform_oauth_redirect";
  }
  if (url.protocol === "https:" && url.hostname === "claude.ai") {
    return url.pathname === "/api/mcp/auth_callback";
  }
  return isLoopbackRedirect(url) && /^\/callback(?:\/[A-Za-z0-9._~-]+)?\/?$/.test(url.pathname);
}

function isLoopbackRedirect(url: URL): boolean {
  return url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
    !url.username && !url.password && !url.search && !url.hash;
}

function redirectMatchesRegistered(candidate: string, registered: string[]): boolean {
  if (registered.includes(candidate)) return true;
  let candidateUrl: URL;
  try {
    candidateUrl = new URL(candidate);
  } catch {
    return false;
  }
  if (!isLoopbackRedirect(candidateUrl)) return false;

  return registered.some((value) => {
    let registeredUrl: URL;
    try {
      registeredUrl = new URL(value);
    } catch {
      return false;
    }
    return isLoopbackRedirect(registeredUrl) &&
      registeredUrl.protocol === candidateUrl.protocol &&
      registeredUrl.hostname === candidateUrl.hostname &&
      registeredUrl.pathname === candidateUrl.pathname;
  });
}

function normalizeStringArray(
  value: unknown,
  fallback: string[],
  allowed: string[],
  field: string,
): string[] {
  const source = value === undefined ? fallback : value;
  if (!Array.isArray(source) || source.length < 1 || source.length > allowed.length) {
    throw new OAuthError(400, "invalid_client_metadata", `${field} is invalid.`);
  }
  const normalized = Array.from(new Set(source.map((item) => {
    if (typeof item !== "string" || !allowed.includes(item)) {
      throw new OAuthError(400, "invalid_client_metadata", `${field} contains an unsupported value.`);
    }
    return item;
  })));
  return normalized;
}

function normalizeClientUri(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2_048) {
    throw new OAuthError(400, "invalid_client_metadata", "client_uri is invalid.");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
  } catch {
    throw new OAuthError(400, "invalid_client_metadata", "client_uri must be an HTTPS URL.");
  }
  return value;
}

function normalizeDisplayText(value: unknown, fallback: string, maximum: number): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    throw new OAuthError(400, "invalid_client_metadata", "client_name must be text.");
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximum) {
    throw new OAuthError(400, "invalid_client_metadata", "client_name is invalid.");
  }
  return normalized;
}

function parseStoredRedirects(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  } catch {
    // Stored client metadata is treated as invalid below.
  }
  throw new OAuthError(400, "invalid_request", "The OAuth client registration is invalid.");
}

function redirectHostFromStoredUris(value: string): string {
  try {
    const first = parseStoredRedirects(value)[0];
    return first ? new URL(first).host : "AI client";
  } catch {
    return "AI client";
  }
}

function normalizeScope(value: string | null): string {
  if (value === null || !value.trim()) return KNOWLEDGE_SCOPE;
  const scopes = parseScope(value);
  if (scopes.length !== 1 || scopes[0] !== KNOWLEDGE_SCOPE) {
    throw new OAuthError(400, "invalid_scope", `Only ${KNOWLEDGE_SCOPE} is supported.`);
  }
  return KNOWLEDGE_SCOPE;
}

function parseScope(value: string): string[] {
  return Array.from(new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))).sort();
}

function singleSearchParam(
  params: URLSearchParams,
  name: string,
  required: boolean,
): string | null {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw new OAuthError(400, "invalid_request", `${name} must appear only once.`);
  }
  const value = values[0] ?? null;
  if (required && (value === null || value === "")) {
    throw new OAuthError(400, "invalid_request", `${name} is required.`);
  }
  return value;
}

function boundedParam(value: string | null, name: string, maximum: number): string {
  if (value === null || !value || value.length > maximum) {
    throw new OAuthError(400, "invalid_request", `${name} is invalid.`);
  }
  return value;
}

function boundedOptionalParam(
  value: string | null,
  name: string,
  maximum: number,
): string | null {
  if (value !== null && value.length > maximum) {
    throw new OAuthError(400, "invalid_request", `${name} is invalid.`);
  }
  return value;
}

function requireContentType(request: Request, expected: string): void {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes(expected)) {
    throw new OAuthError(415, "invalid_request", `Content-Type must be ${expected}.`);
  }
}

async function readLimitedText(request: Request): Promise<string> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new OAuthError(413, "invalid_request", "The request body is too large.");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      throw new OAuthError(413, "invalid_request", "The request body is too large.");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Converted to the standard OAuth error below.
  }
  throw new OAuthError(400, "invalid_request", "The request body must contain a JSON object.");
}

async function consumeRateLimit(
  request: Request,
  purpose: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const source = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const bucketKey = `${purpose}:${await sha256Hex(source)}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - windowMs).toISOString();
  const row = await getD1().prepare(`
    INSERT INTO oauth_rate_limits (bucket_key, window_started_at, request_count, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      request_count = CASE
        WHEN oauth_rate_limits.window_started_at <= ? THEN 1
        ELSE oauth_rate_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN oauth_rate_limits.window_started_at <= ? THEN excluded.window_started_at
        ELSE oauth_rate_limits.window_started_at
      END,
      updated_at = excluded.updated_at
    RETURNING request_count, window_started_at
  `).bind(bucketKey, nowIso, nowIso, cutoffIso, cutoffIso)
    .first<{ request_count: number; window_started_at: string }>();
  if (!row || row.request_count <= limit) return;

  const windowStartedAt = Date.parse(row.window_started_at);
  const retryAfter = Number.isFinite(windowStartedAt)
    ? Math.max(1, Math.ceil((windowStartedAt + windowMs - now.getTime()) / 1_000))
    : Math.ceil(windowMs / 1_000);
  throw new OAuthError(
    429,
    "temporarily_unavailable",
    "Too many OAuth requests. Try again later.",
    { "Retry-After": String(retryAfter) },
  );
}

function authorizationRedirect(
  redirectUri: string,
  values: { code?: string; error?: string; error_description?: string; state: string | null },
): Response {
  const location = new URL(redirectUri);
  if (values.code) location.searchParams.set("code", values.code);
  if (values.error) location.searchParams.set("error", values.error);
  if (values.error_description) {
    location.searchParams.set("error_description", values.error_description);
  }
  if (values.state !== null) location.searchParams.set("state", values.state);
  return new Response(null, {
    status: 303,
    headers: { ...NO_STORE_HEADERS, Location: location.toString() },
  });
}

function resourceAuthError(
  request: Request,
  status: 401 | 403,
  code: "invalid_token" | "insufficient_scope",
  message: string,
): OAuthError {
  const metadataUrl = `${canonicalOauthOrigin(request)}/.well-known/oauth-protected-resource`;
  const parameters = [
    `resource_metadata="${metadataUrl}"`,
    `scope="${KNOWLEDGE_SCOPE}"`,
  ];
  if (status === 403) parameters.unshift('error="insufficient_scope"');
  return new OAuthError(status, code, message, {
    "WWW-Authenticate": `Bearer ${parameters.join(", ")}`,
  });
}

function invalidGrant(): OAuthError {
  return new OAuthError(400, "invalid_grant", "The authorization grant is invalid or expired.");
}

function configuredOwnerEmail(): string {
  const owner = normalizeEmail(env.OWNER_EMAIL ?? "");
  if (!owner) {
    throw new OAuthError(503, "server_error", "Owner access is not configured.");
  }
  return owner;
}

function getD1(): D1Database {
  if (!env.DB) throw new OAuthError(503, "server_error", "OAuth storage is unavailable.");
  return env.DB;
}

function randomOpaqueToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${prefix}${secret}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isOpaqueToken(value: string, prefix: string): boolean {
  return value.startsWith(prefix) && value.length === prefix.length + 64 &&
    /^[a-f0-9]+$/.test(value.slice(prefix.length));
}

function isS256Challenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isPkceVerifier(value: string): boolean {
  return value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(value);
}

function tokenHint(token: string): string {
  return `…${token.slice(-8)}`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function constantTimeEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1" ||
    normalized === "[::1]";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
