import { getBookmark, getBookmarkPreview } from "@/lib/bookmarks";
import { ApiError, apiErrorResponse, assertOwnerAccess } from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertOwnerAccess(request);
    const { id } = await context.params;
    const bookmark = await getBookmark(id);
    if (!bookmark) throw new ApiError(404, "Bookmark not found.");

    const preview = await getBookmarkPreview(bookmark);
    if (!preview) throw new ApiError(404, "Preview image is not available for this bookmark.");

    const etag = preview.httpEtag || `"${preview.etag}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    return new Response(preview.body, {
      headers: {
        "Content-Type": preview.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(preview.size),
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        ETag: etag,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
