import { createBookmark, listBookmarks } from "@/lib/bookmarks";
import {
  apiErrorResponse,
  assertOwnerAccess,
  assertSameOriginMutation,
  readUrlSubmission,
} from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    const url = new URL(request.url);
    const bookmarks = await listBookmarks({
      query: url.searchParams.get("query") ?? url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: numberParameter(url.searchParams.get("limit")),
    });
    return Response.json(
      { bookmarks },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    assertSameOriginMutation(request);
    const submittedUrl = await readUrlSubmission(request);
    const bookmark = await createBookmark(submittedUrl);
    return Response.json(
      { bookmark },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function numberParameter(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
