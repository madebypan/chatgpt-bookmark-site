import { retryBookmark } from "@/lib/bookmarks";
import {
  apiErrorResponse,
  assertOwnerAccess,
  assertSameOriginMutation,
} from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertOwnerAccess(request);
    assertSameOriginMutation(request);
    const { id } = await context.params;
    const bookmark = await retryBookmark(id);
    return Response.json(
      { bookmark },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
