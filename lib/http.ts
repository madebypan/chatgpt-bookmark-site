import { env } from "cloudflare:workers";
import { ExtractionError } from "@/lib/extractor";

type SecretBindings = {
  OWNER_EMAIL?: string;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function assertOwnerAccess(request: Request): void {
  if (isLocalDevelopmentRequest(request)) return;

  const ownerEmail = getOwnerEmail();
  if (!ownerEmail) {
    throw new ApiError(503, "Owner access is not configured.");
  }

  const authenticatedEmail = normalizeEmail(
    request.headers.get("oai-authenticated-user-email") ?? "",
  );
  if (!authenticatedEmail) {
    throw new ApiError(401, "Sign in with the owner ChatGPT account to continue.");
  }
  if (!constantTimeEquals(ownerEmail, authenticatedEmail)) {
    throw new ApiError(403, "This Site is available only to its owner.");
  }
}

export function assertSameOriginMutation(request: Request): void {
  if (isLocalDevelopmentRequest(request)) return;

  const requestOrigin = new URL(request.url).origin;
  const submittedOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (!submittedOrigin && !fetchSite) {
    throw new ApiError(403, "A same-origin browser request is required.");
  }
  if (submittedOrigin && submittedOrigin !== requestOrigin) {
    throw new ApiError(403, "Cross-site changes are not allowed.");
  }

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "Cross-site changes are not allowed.");
  }
}

export function isOwnerEmail(value: string): boolean {
  const ownerEmail = getOwnerEmail();
  const candidate = normalizeEmail(value);
  return Boolean(ownerEmail && candidate && constantTimeEquals(ownerEmail, candidate));
}

export async function readUrlSubmission(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  let value: unknown;

  if (contentType.includes("application/json")) {
    try {
      const payload = await request.json() as { url?: unknown };
      value = payload?.url;
    } catch {
      throw new ApiError(400, "The request body must contain valid JSON.");
    }
  } else if (contentType.includes("form")) {
    const payload = await request.formData();
    value = payload.get("url");
  } else {
    value = await request.text();
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "A non-empty `url` value is required.");
  }
  if (value.length > 8_192) throw new ApiError(400, "The submitted URL is too long.");
  return value.trim();
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers: error.headers,
      },
    );
  }

  if (error instanceof ExtractionError) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail = error instanceof Error && error.cause instanceof Error
    ? error.cause.message
    : "";
  const combined = `${message}\n${detail}`;
  if (/no such table:\s*bookmarks/i.test(combined) || /from ["`]bookmarks["`]/i.test(combined)) {
    return Response.json(
      {
        error: "The bookmarks table is unavailable. Generate the D1 migration locally, then deploy through Sites so the generated migration is applied.",
      },
      { status: 500 },
    );
  }
  if (/no such table:\s*capture_devices/i.test(combined) || /from ["`]capture_devices["`]/i.test(combined)) {
    return Response.json(
      { error: "The phone-key table is unavailable. Apply the latest Site database migration, then try again." },
      { status: 500 },
    );
  }
  if (/R2 binding `ARCHIVE` is unavailable/i.test(combined)) {
    return Response.json(
      { error: "The archive storage is unavailable. Deploy this project through Sites with the ARCHIVE R2 binding enabled." },
      { status: 500 },
    );
  }

  return Response.json({ error: message }, { status: 500 });
}

function isLocalRequest(request: Request): boolean {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
  } catch {
    return false;
  }
}

function isLocalDevelopmentRequest(request: Request): boolean {
  return process.env.NODE_ENV === "development" && isLocalRequest(request);
}

function getOwnerEmail(): string {
  return normalizeEmail((env as unknown as SecretBindings).OWNER_EMAIL ?? "");
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
