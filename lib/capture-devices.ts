import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { captureDevices } from "@/db/schema";
import { ApiError } from "@/lib/http";

export const CAPTURE_TOKEN_PREFIX = "relay_cap_";
export const MAX_ACTIVE_CAPTURE_DEVICES = 5;
export const CAPTURE_REQUESTS_PER_HOUR = 60;

const captureDeviceView = {
  id: captureDevices.id,
  name: captureDevices.name,
  tokenHint: captureDevices.tokenHint,
  useCount: captureDevices.useCount,
  lastUsedAt: captureDevices.lastUsedAt,
  revokedAt: captureDevices.revokedAt,
  createdAt: captureDevices.createdAt,
};

export type CaptureDeviceView = {
  id: string;
  name: string;
  tokenHint: string;
  useCount: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function generateCaptureToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${CAPTURE_TOKEN_PREFIX}${secret}`;
}

export async function hashCaptureToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export async function listCaptureDevices(): Promise<CaptureDeviceView[]> {
  return getDb().select(captureDeviceView).from(captureDevices)
    .where(isNull(captureDevices.revokedAt))
    .orderBy(desc(captureDevices.createdAt), desc(captureDevices.id));
}

export async function createCaptureDevice(input: {
  name?: unknown;
} = {}): Promise<{ device: CaptureDeviceView; token: string }> {
  const name = normalizeDeviceName(input.name);
  const db = getDb();
  const activeDevices = await db.select({ id: captureDevices.id })
    .from(captureDevices)
    .where(isNull(captureDevices.revokedAt))
    .limit(MAX_ACTIVE_CAPTURE_DEVICES);

  if (activeDevices.length >= MAX_ACTIVE_CAPTURE_DEVICES) {
    throw new ApiError(
      409,
      `At most ${MAX_ACTIVE_CAPTURE_DEVICES} active capture devices are allowed. Revoke one before creating another.`,
    );
  }

  const token = generateCaptureToken();
  const now = new Date().toISOString();
  const [device] = await db.insert(captureDevices).values({
    id: crypto.randomUUID(),
    name,
    tokenHash: await hashCaptureToken(token),
    tokenHint: `…${token.slice(-8)}`,
    createdAt: now,
  }).returning(captureDeviceView);

  if (!device) throw new Error("The capture device could not be created.");
  return { device, token };
}

export async function revokeCaptureDevice(id: string): Promise<CaptureDeviceView> {
  const normalizedId = id.trim();
  if (!normalizedId || normalizedId.length > 128) {
    throw new ApiError(400, "A valid capture device id is required.");
  }

  const db = getDb();
  const [existing] = await db.select(captureDeviceView).from(captureDevices)
    .where(eq(captureDevices.id, normalizedId))
    .limit(1);
  if (!existing) throw new ApiError(404, "Capture device not found.");
  if (existing.revokedAt) return existing;

  const [revoked] = await db.update(captureDevices).set({
    revokedAt: new Date().toISOString(),
  }).where(and(
    eq(captureDevices.id, normalizedId),
    isNull(captureDevices.revokedAt),
  )).returning(captureDeviceView);

  if (revoked) return revoked;

  // A concurrent revoke is still a successful, idempotent operation.
  const [concurrentlyRevoked] = await db.select(captureDeviceView)
    .from(captureDevices)
    .where(eq(captureDevices.id, normalizedId))
    .limit(1);
  if (!concurrentlyRevoked) throw new ApiError(404, "Capture device not found.");
  return concurrentlyRevoked;
}

export async function authenticateCaptureDevice(
  request: Request,
): Promise<CaptureDeviceView> {
  const token = readBearerToken(request);
  const tokenHash = await hashCaptureToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
  const freshWindow = or(
    isNull(captureDevices.rateWindowStartedAt),
    lt(captureDevices.rateWindowStartedAt, cutoffIso),
  );
  const [device] = await getDb().update(captureDevices).set({
    lastUsedAt: nowIso,
    useCount: sql`${captureDevices.useCount} + 1`,
    rateWindowStartedAt: sql`CASE
      WHEN ${captureDevices.rateWindowStartedAt} IS NULL
        OR ${captureDevices.rateWindowStartedAt} < ${cutoffIso}
      THEN ${nowIso}
      ELSE ${captureDevices.rateWindowStartedAt}
    END`,
    rateWindowCount: sql`CASE
      WHEN ${captureDevices.rateWindowStartedAt} IS NULL
        OR ${captureDevices.rateWindowStartedAt} < ${cutoffIso}
      THEN 1
      ELSE ${captureDevices.rateWindowCount} + 1
    END`,
  }).where(and(
    eq(captureDevices.tokenHash, tokenHash),
    isNull(captureDevices.revokedAt),
    or(freshWindow, lt(captureDevices.rateWindowCount, CAPTURE_REQUESTS_PER_HOUR)),
  )).returning(captureDeviceView);

  if (device) return device;

  const [matchedDevice] = await getDb().select({
    rateWindowStartedAt: captureDevices.rateWindowStartedAt,
  }).from(captureDevices).where(and(
    eq(captureDevices.tokenHash, tokenHash),
    isNull(captureDevices.revokedAt),
  )).limit(1);
  if (!matchedDevice) throw invalidCaptureToken();

  const windowStartedAt = Date.parse(matchedDevice.rateWindowStartedAt ?? nowIso);
  const retryAfter = Number.isFinite(windowStartedAt)
    ? Math.max(1, Math.ceil((windowStartedAt + 60 * 60 * 1_000 - now.getTime()) / 1_000))
    : 3_600;
  throw new ApiError(
    429,
    "This phone has sent too many capture requests. Try again later.",
    { "Retry-After": String(retryAfter) },
  );
}

function normalizeDeviceName(value: unknown): string {
  if (value === undefined) return "Capture device";
  if (typeof value !== "string") {
    throw new ApiError(400, "Capture device name must be a string.");
  }
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) throw new ApiError(400, "Capture device name cannot be empty.");
  if (name.length > 80) {
    throw new ApiError(400, "Capture device name must be 80 characters or fewer.");
  }
  return name;
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (
    !token ||
    !token.startsWith(CAPTURE_TOKEN_PREFIX) ||
    token.length !== CAPTURE_TOKEN_PREFIX.length + 64
  ) {
    throw invalidCaptureToken();
  }
  return token;
}

function invalidCaptureToken(): ApiError {
  return new ApiError(401, "A valid capture device bearer token is required.");
}
