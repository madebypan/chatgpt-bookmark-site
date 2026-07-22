import { createBookmark } from "@/lib/bookmarks";
import { authenticateCaptureDevice } from "@/lib/capture-devices";
import { ApiError, apiErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request): Promise<Response> {
  try {
    await authenticateCaptureDevice(request);
    assertCaptureOrigin(request);
    const submittedUrl = await readCaptureUrl(request);
    await createBookmark(submittedUrl);
    return Response.json(
      { ok: true },
      { status: 202, headers: responseHeaders },
    );
  } catch (error) {
    return withSecurityHeaders(apiErrorResponse(error));
  }
}

async function readCaptureUrl(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "The capture request body must be JSON.");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    throw new ApiError(413, "The capture request body is too large.");
  }

  const rawBody = await readBoundedTextBody(request, 16_384);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, "The request body must contain valid JSON.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "The request body must be a JSON object.");
  }
  if (Object.keys(payload).some((key) => key !== "url")) {
    throw new ApiError(400, "Only the `url` field is accepted.");
  }
  const value = (payload as { url?: unknown }).url;
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "A non-empty `url` value is required.");
  }
  if (value.length > 8_192) throw new ApiError(400, "The submitted URL is too long.");
  return value.trim();
}

async function readBoundedTextBody(request: Request, maximumBytes: number): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new ApiError(413, "The capture request body is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "The request body could not be read.");
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    throw new ApiError(400, "The request body must be valid UTF-8.");
  }
}

function assertCaptureOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiError(403, "Cross-site capture requests are not allowed.");
  }
}

function withSecurityHeaders(response: Response): Response {
  if (response.status >= 500) {
    response = Response.json(
      { error: "Capture is temporarily unavailable." },
      { status: response.status },
    );
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (response.status === 401) {
    response.headers.set("WWW-Authenticate", 'Bearer realm="capture"');
  }
  return response;
}
