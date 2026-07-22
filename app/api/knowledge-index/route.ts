import {
  backfillKnowledgeIndex,
  getKnowledgeIndexStatus,
} from "@/lib/knowledge";
import {
  advanceFileSearchIndex,
  getFileSearchIndexStatus,
} from "@/lib/file-search";
import {
  apiErrorResponse,
  assertOwnerAccess,
  assertSameOriginMutation,
} from "@/lib/http";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    return Response.json(
      {
        status: await getKnowledgeIndexStatus(),
        semantic: await getFileSearchIndexStatus(),
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    return secure(apiErrorResponse(error));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    assertSameOriginMutation(request);
    const result = await backfillKnowledgeIndex({ limit: 5 });
    const semantic = await advanceFileSearchIndex({
      limit: 5,
      preferSitesEmbeddings: true,
    });
    return Response.json(
      {
        result,
        status: await getKnowledgeIndexStatus(),
        semantic,
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    return secure(apiErrorResponse(error));
  }
}

function secure(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
