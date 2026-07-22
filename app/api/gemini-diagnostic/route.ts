import { env } from "cloudflare:workers";
import { STORE_DISPLAY_NAME } from "@/lib/file-search";
import { probeGeminiApiKey } from "@/lib/gemini-diagnostic";
import {
  ApiError,
  apiErrorResponse,
  assertOwnerAccess,
} from "@/lib/http";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

type GeminiBindings = {
  GEMINI_API_KEY?: string;
};

export async function GET(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    const apiKey = (env as unknown as GeminiBindings).GEMINI_API_KEY?.trim();
    if (!apiKey) throw new ApiError(503, "Gemini API key is not configured.");
    return Response.json(
      await probeGeminiApiKey(apiKey, fetch, { storeDisplayName: STORE_DISPLAY_NAME }),
      { headers: responseHeaders },
    );
  } catch (error) {
    const response = apiErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  }
}
