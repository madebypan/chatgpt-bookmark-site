import { exchangeOauthToken, oauthErrorResponse } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await exchangeOauthToken(request);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
