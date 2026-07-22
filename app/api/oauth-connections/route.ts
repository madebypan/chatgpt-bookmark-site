import { listOauthConnections, OAuthError } from "@/lib/oauth";
import { apiErrorResponse, assertOwnerAccess } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    return Response.json(
      { connections: await listOauthConnections() },
      { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch (error) {
    return secureOwnerError(error);
  }
}

function secureOwnerError(error: unknown): Response {
  const response = error instanceof OAuthError
    ? Response.json({ error: error.message }, { status: error.status })
    : apiErrorResponse(error);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
