/** Cloudflare Worker entry point used by OpenAI Sites hosting. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ARCHIVE: R2Bucket;
  OWNER_EMAIL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_FILE_SEARCH_MODEL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const localDevelopment = process.env.NODE_ENV === "development" &&
      isLocalHostname(url.hostname);
    if (!isPublicTransportPath(url.pathname) && !localDevelopment) {
      const authorizationFailure = authorizeOwnerRequest(request, env, url);
      if (authorizationFailure) return authorizationFailure;
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    if (isPublicStaticPath(url.pathname)) return response;
    return withPrivateSecurityHeaders(response);
  },
};

export default worker;

function authorizeOwnerRequest(
  request: Request,
  env: Env,
  url: URL,
): Response | null {
  const configuredOwner = normalizeEmail(env.OWNER_EMAIL ?? "");
  if (!configuredOwner) {
    return Response.json(
      { error: "Owner access is not configured." },
      { status: 503, headers: privateSecurityHeaders() },
    );
  }

  const authenticatedEmail = normalizeEmail(
    request.headers.get("oai-authenticated-user-email") ?? "",
  );
  if (!authenticatedEmail) {
    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: "Sign in with the owner ChatGPT account to continue." },
        { status: 401, headers: privateSecurityHeaders() },
      );
    }

    const requestedReturnTo = `${url.pathname}${url.search}`;
    const returnTo = requestedReturnTo.startsWith("//") ? "/" : requestedReturnTo;
    const location = `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`;
    return new Response(null, {
      status: 302,
      headers: { ...privateSecurityHeaders(), Location: location },
    });
  }

  if (!constantTimeEquals(configuredOwner, authenticatedEmail)) {
    return Response.json(
      { error: "This Site is available only to its owner." },
      { status: 403, headers: privateSecurityHeaders() },
    );
  }

  return null;
}

function isPublicTransportPath(pathname: string): boolean {
  return pathname === "/api/capture" ||
    pathname === "/mcp" ||
    pathname === "/mcp/" ||
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/mcp" ||
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/oauth/register" ||
    pathname === "/oauth/token" ||
    pathname === "/oauth/revoke" ||
    pathname === "/signin-with-chatgpt" ||
    pathname === "/signout-with-chatgpt" ||
    pathname === "/callback" ||
    isPublicStaticPath(pathname);
}

function isPublicStaticPath(pathname: string): boolean {
  return pathname === "/favicon.svg" || pathname === "/og.png" ||
    pathname.startsWith("/assets/") || pathname.startsWith("/_next/static/");
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1";
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

function privateSecurityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function withPrivateSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateSecurityHeaders())) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
