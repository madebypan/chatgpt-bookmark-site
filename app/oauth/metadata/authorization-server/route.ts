import {
  authorizationServerMetadata,
  oauthErrorResponse,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json(authorizationServerMetadata(request), {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
