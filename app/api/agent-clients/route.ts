import { createAgentClient, listAgentClients } from "@/lib/agent-clients";
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
      { clients: await listAgentClients() },
      { headers: responseHeaders },
    );
  } catch (error) {
    return secure(apiErrorResponse(error));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    assertSameOriginMutation(request);
    const payload = await readCreatePayload(request);
    const created = await createAgentClient({
      name: payload.name,
      scopes: ["search", "read", "recent"],
    });
    return Response.json(created, { status: 201, headers: responseHeaders });
  } catch (error) {
    return secure(apiErrorResponse(error));
  }
}

async function readCreatePayload(request: Request): Promise<{ name?: unknown }> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "The request body must be JSON.");
  }

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 4_096) {
    throw new ApiError(413, "The request body is too large.");
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
  const object = payload as Record<string, unknown>;
  if (Object.keys(object).some((key) => key !== "name")) {
    throw new ApiError(400, "Only the agent name may be supplied.");
  }
  return { name: object.name };
}

function secure(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
