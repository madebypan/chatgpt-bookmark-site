import { getBookmark, removeBookmark } from "@/lib/bookmarks";
import {
  ApiError,
  apiErrorResponse,
  assertOwnerAccess,
  assertSameOriginMutation,
} from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertOwnerAccess(request);
    const { id } = await context.params;
    const bookmark = await getBookmark(id);
    if (!bookmark) throw new ApiError(404, "Bookmark not found.");
    return Response.json(
      { bookmark },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertOwnerAccess(request);
    assertSameOriginMutation(request);
    const { id } = await context.params;
    await removeBookmark(id);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
