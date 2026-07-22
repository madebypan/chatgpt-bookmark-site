import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { agentClients } from "@/db/schema";
import { ApiError } from "@/lib/http";

export const AGENT_TOKEN_PREFIX = "relay_agent_";
export const AGENT_SCOPES = ["search", "read", "recent"] as const;
export const MAX_ACTIVE_AGENT_CLIENTS = 5;
export const AGENT_REQUESTS_PER_HOUR = 300;

export type AgentScope = typeof AGENT_SCOPES[number];

export type AgentClientView = {
  id: string;
  name: string;
  tokenHint: string;
  scopes: AgentScope[];
  useCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

const agentClientSelect = {
  id: agentClients.id,
  name: agentClients.name,
  ownerEmail: agentClients.ownerEmail,
  tokenHint: agentClients.tokenHint,
  scopes: agentClients.scopes,
  useCount: agentClients.useCount,
  lastUsedAt: agentClients.lastUsedAt,
  expiresAt: agentClients.expiresAt,
  revokedAt: agentClients.revokedAt,
  createdAt: agentClients.createdAt,
};

type StoredAgentClient = {
  id: string;
  name: string;
  ownerEmail: string;
  tokenHint: string;
  scopes: string;
  useCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function generateAgentToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${AGENT_TOKEN_PREFIX}${secret}`;
}

export async function hashAgentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export async function listAgentClients(): Promise<AgentClientView[]> {
  const ownerEmail = configuredOwnerEmail();
  const rows = await getDb().select(agentClientSelect).from(agentClients)
    .where(and(
      eq(agentClients.ownerEmail, ownerEmail),
      isNull(agentClients.revokedAt),
    ))
    .orderBy(desc(agentClients.createdAt), desc(agentClients.id));
  return rows.map((row) => agentClientView(row));
}

export async function createAgentClient(input: {
  name?: unknown;
  scopes?: unknown;
  expiresAt?: unknown;
} = {}): Promise<{ client: AgentClientView; token: string }> {
  const name = normalizeClientName(input.name);
  const scopes = normalizeScopes(input.scopes);
  const expiresAt = normalizeExpiry(input.expiresAt);
  const ownerEmail = configuredOwnerEmail();
  const db = getDb();
  const active = await db.select({ id: agentClients.id }).from(agentClients)
    .where(and(
      eq(agentClients.ownerEmail, ownerEmail),
      isNull(agentClients.revokedAt),
      or(isNull(agentClients.expiresAt), gt(agentClients.expiresAt, new Date().toISOString())),
    ))
    .limit(MAX_ACTIVE_AGENT_CLIENTS);
  if (active.length >= MAX_ACTIVE_AGENT_CLIENTS) {
    throw new ApiError(
      409,
      `At most ${MAX_ACTIVE_AGENT_CLIENTS} active agent clients are allowed. Revoke one before creating another.`,
    );
  }

  const token = generateAgentToken();
  const now = new Date().toISOString();
  const [stored] = await db.insert(agentClients).values({
    id: crypto.randomUUID(),
    name,
    ownerEmail,
    tokenHash: await hashAgentToken(token),
    tokenHint: `…${token.slice(-8)}`,
    scopes: JSON.stringify(scopes),
    expiresAt,
    createdAt: now,
  }).returning(agentClientSelect);
  if (!stored) throw new Error("The agent client could not be created.");
  return { client: agentClientView(stored), token };
}

export async function revokeAgentClient(id: string): Promise<AgentClientView> {
  const normalizedId = normalizeClientId(id);
  const ownerEmail = configuredOwnerEmail();
  const db = getDb();
  const [existing] = await db.select(agentClientSelect).from(agentClients)
    .where(and(
      eq(agentClients.id, normalizedId),
      eq(agentClients.ownerEmail, ownerEmail),
    ))
    .limit(1);
  if (!existing) throw new ApiError(404, "Agent client not found.");
  if (existing.revokedAt) return agentClientView(existing);

  const [revoked] = await db.update(agentClients).set({
    revokedAt: new Date().toISOString(),
  }).where(and(
    eq(agentClients.id, normalizedId),
    eq(agentClients.ownerEmail, ownerEmail),
    isNull(agentClients.revokedAt),
  )).returning(agentClientSelect);
  if (revoked) return agentClientView(revoked);

  const [concurrentlyRevoked] = await db.select(agentClientSelect)
    .from(agentClients)
    .where(and(
      eq(agentClients.id, normalizedId),
      eq(agentClients.ownerEmail, ownerEmail),
    ))
    .limit(1);
  if (!concurrentlyRevoked) throw new ApiError(404, "Agent client not found.");
  return agentClientView(concurrentlyRevoked);
}

export async function authenticateAgentClient(
  request: Request,
  requiredScope: AgentScope,
): Promise<AgentClientView> {
  if (!AGENT_SCOPES.includes(requiredScope)) {
    throw new ApiError(500, "The requested agent scope is not configured.");
  }
  const token = readBearerToken(request);
  const tokenHash = await hashAgentToken(token);
  const ownerEmail = configuredOwnerEmail();
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
  const activeExpiry = or(isNull(agentClients.expiresAt), gt(agentClients.expiresAt, nowIso));
  const freshWindow = or(
    isNull(agentClients.rateWindowStartedAt),
    lt(agentClients.rateWindowStartedAt, cutoffIso),
  );
  const [stored] = await getDb().update(agentClients).set({
    lastUsedAt: nowIso,
    useCount: sql`${agentClients.useCount} + 1`,
    rateWindowStartedAt: sql`CASE
      WHEN ${agentClients.rateWindowStartedAt} IS NULL
        OR ${agentClients.rateWindowStartedAt} < ${cutoffIso}
      THEN ${nowIso}
      ELSE ${agentClients.rateWindowStartedAt}
    END`,
    rateWindowCount: sql`CASE
      WHEN ${agentClients.rateWindowStartedAt} IS NULL
        OR ${agentClients.rateWindowStartedAt} < ${cutoffIso}
      THEN 1
      ELSE ${agentClients.rateWindowCount} + 1
    END`,
  }).where(and(
    eq(agentClients.tokenHash, tokenHash),
    eq(agentClients.ownerEmail, ownerEmail),
    isNull(agentClients.revokedAt),
    activeExpiry,
    or(freshWindow, lt(agentClients.rateWindowCount, AGENT_REQUESTS_PER_HOUR)),
  )).returning(agentClientSelect);

  if (stored) {
    const client = agentClientView(stored);
    assertAgentScope(client, requiredScope);
    return client;
  }

  const [matched] = await getDb().select({
    scopes: agentClients.scopes,
    rateWindowStartedAt: agentClients.rateWindowStartedAt,
  }).from(agentClients).where(and(
    eq(agentClients.tokenHash, tokenHash),
    eq(agentClients.ownerEmail, ownerEmail),
    isNull(agentClients.revokedAt),
    activeExpiry,
  )).limit(1);
  if (!matched) throw invalidAgentToken();

  const scopes = parseStoredScopes(matched.scopes);
  if (!scopes.includes(requiredScope)) {
    throw new ApiError(403, `This agent client does not have the ${requiredScope} scope.`);
  }
  const windowStartedAt = Date.parse(matched.rateWindowStartedAt ?? nowIso);
  const retryAfter = Number.isFinite(windowStartedAt)
    ? Math.max(1, Math.ceil((windowStartedAt + 60 * 60 * 1_000 - now.getTime()) / 1_000))
    : 3_600;
  throw new ApiError(
    429,
    "This agent client has sent too many requests. Try again later.",
    { "Retry-After": String(retryAfter) },
  );
}

function normalizeClientName(value: unknown): string {
  if (value === undefined) return "Knowledge agent";
  if (typeof value !== "string") throw new ApiError(400, "Agent client name must be a string.");
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) throw new ApiError(400, "Agent client name cannot be empty.");
  if (name.length > 80) throw new ApiError(400, "Agent client name must be 80 characters or fewer.");
  return name;
}

function normalizeScopes(value: unknown): AgentScope[] {
  if (value === undefined) return [...AGENT_SCOPES];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, "Agent scopes must be a non-empty array.");
  }
  const scopes = [...new Set(value)];
  if (scopes.some((scope) => typeof scope !== "string" || !AGENT_SCOPES.includes(scope as AgentScope))) {
    throw new ApiError(400, "Agent scopes may contain only search, read, and recent.");
  }
  return scopes as AgentScope[];
}

function normalizeExpiry(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "Agent expiry must be an ISO date string.");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new ApiError(400, "Agent expiry must be a future date.");
  }
  return new Date(timestamp).toISOString();
}

function normalizeClientId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) throw new ApiError(400, "A valid agent client id is required.");
  return id;
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  const secret = token?.slice(AGENT_TOKEN_PREFIX.length) ?? "";
  if (
    !token?.startsWith(AGENT_TOKEN_PREFIX) ||
    secret.length !== 64 ||
    !/^[a-f\d]{64}$/i.test(secret)
  ) {
    throw invalidAgentToken();
  }
  return token;
}

function parseStoredScopes(value: string): AgentScope[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeScopes(parsed);
  } catch {
    return [];
  }
}

function agentClientView(client: StoredAgentClient): AgentClientView {
  return {
    id: client.id,
    name: client.name,
    tokenHint: client.tokenHint,
    scopes: parseStoredScopes(client.scopes),
    useCount: client.useCount,
    lastUsedAt: client.lastUsedAt,
    expiresAt: client.expiresAt,
    revokedAt: client.revokedAt,
    createdAt: client.createdAt,
  };
}

function assertAgentScope(client: AgentClientView, requiredScope: AgentScope): void {
  if (!client.scopes.includes(requiredScope)) {
    throw new ApiError(403, `This agent client does not have the ${requiredScope} scope.`);
  }
}

function invalidAgentToken(): ApiError {
  return new ApiError(401, "A valid agent client bearer token is required.");
}

function configuredOwnerEmail(): string {
  const ownerEmail = (env.OWNER_EMAIL ?? "").trim().toLocaleLowerCase("en-US");
  if (!ownerEmail) throw new ApiError(503, "Owner access is not configured.");
  return ownerEmail;
}
