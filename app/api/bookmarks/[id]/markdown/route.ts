import { getBookmark, getBookmarkMarkdown } from "@/lib/bookmarks";
import { ApiError, apiErrorResponse, assertOwnerAccess } from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertOwnerAccess(request);
    const { id } = await context.params;
    const bookmark = await getBookmark(id);
    if (!bookmark) throw new ApiError(404, "Bookmark not found.");
    const markdown = await getBookmarkMarkdown(bookmark);
    if (markdown === null) throw new ApiError(404, "Clean Markdown is not available for this bookmark.");

    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `inline; filename="bookmark-${safeFilenamePart(id)}.md"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-z\d_-]/gi, "").slice(0, 80) || "content";
}
