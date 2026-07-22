import { getAiLibrary } from "@/lib/bookmarks";
import { apiErrorResponse, assertOwnerAccess } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim() || "";
    const limitValue = Number(url.searchParams.get("limit"));
    const bookmarks = await getAiLibrary({
      query: query || undefined,
      limit: Number.isFinite(limitValue) && limitValue > 0 ? limitValue : undefined,
    });

    const heading = query
      ? `# Saved information matching “${query.replace(/[\r\n]+/g, " ")}”`
      : "# Saved information library";
    const sections = bookmarks.map((bookmark, index) => [
      `<!-- bookmark ${index + 1}: ${bookmark.id} -->`,
      bookmark.content.trim(),
    ].join("\n"));
    const markdown = [
      heading,
      "",
      `Items: ${bookmarks.length}`,
      "",
      ...sections.flatMap((section) => [section, "", "---", ""]),
    ].join("\n").replace(/\n---\n\s*$/, "\n");

    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": "inline; filename=library.md",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
