import {
  OAuthError,
  revokeOauthConnection,
} from "@/lib/oauth";
import {
  apiErrorResponse,
  assertOwnerAccess,
  assertSameOriginMutation,
} from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertOwnerAccess(request);
    assertSameOriginMutation(request);
    const { id } = await context.params;
    await revokeOauthConnection(id);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch (error) {
    const response = error instanceof OAuthError
      ? Response.json({ error: error.message }, { status: error.status })
      : apiErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  }
}
