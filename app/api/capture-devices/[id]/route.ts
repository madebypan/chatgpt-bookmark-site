import { revokeCaptureDevice } from "@/lib/capture-devices";
import {
  apiErrorResponse,
  assertOwnerAccess,
  assertSameOriginMutation,
} from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertOwnerAccess(request);
    assertSameOriginMutation(request);
    const { id } = await context.params;
    await revokeCaptureDevice(id);
    return Response.json(
      { ok: true },
      { headers: responseHeaders },
    );
  } catch (error) {
    return withSecurityHeaders(apiErrorResponse(error));
  }
}

function withSecurityHeaders(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
