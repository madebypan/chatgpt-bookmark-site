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

    return Response.json(
      { query, count: bookmarks.length, bookmarks },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
