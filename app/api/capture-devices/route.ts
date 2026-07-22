import {
  createCaptureDevice,
  listCaptureDevices,
} from "@/lib/capture-devices";
import {
  ApiError,
  apiErrorResponse,
  assertOwnerAccess,
  assertSameOriginMutation,
} from "@/lib/http";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    return Response.json(
      { devices: await listCaptureDevices() },
      { headers: responseHeaders },
    );
  } catch (error) {
    return withSecurityHeaders(apiErrorResponse(error));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    assertSameOriginMutation(request);
    const payload = await readCreatePayload(request);
    const created = await createCaptureDevice({ name: payload.name });
    return Response.json(
      created,
      { status: 201, headers: responseHeaders },
    );
  } catch (error) {
    return withSecurityHeaders(apiErrorResponse(error));
  }
}

async function readCreatePayload(request: Request): Promise<{ name?: unknown }> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "The request body must be JSON.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ApiError(400, "The request body must contain valid JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "The request body must be a JSON object.");
  }
  return payload as { name?: unknown };
}

function withSecurityHeaders(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
