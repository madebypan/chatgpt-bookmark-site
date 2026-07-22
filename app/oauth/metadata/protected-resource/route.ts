import {
  oauthErrorResponse,
  protectedResourceMetadata,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json(protectedResourceMetadata(request), {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
