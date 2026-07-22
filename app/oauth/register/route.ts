import { oauthErrorResponse, registerOauthClient } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await registerOauthClient(request);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
