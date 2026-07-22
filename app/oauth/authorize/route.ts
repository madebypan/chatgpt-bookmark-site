import {
  authorizedOwnerEmail,
  beginAuthorization,
  completeAuthorization,
  consentErrorResponse,
  consentPageResponse,
  OAuthError,
} from "@/lib/oauth";
import {
  ApiError,
  assertOwnerAccess,
} from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    const ownerEmail = authorizedOwnerEmail(request);
    return consentPageResponse(await beginAuthorization(request, ownerEmail));
  } catch (error) {
    return consentErrorResponse(normalizeOwnerError(error));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertOwnerAccess(request);
    // OAuth clients can open this consent page from a cross-site popup or
    // webview, so Origin and Sec-Fetch-Site are not reliable CSRF signals here.
    // completeAuthorization instead requires a high-entropy, owner-bound,
    // short-lived, single-use transaction created by the authenticated GET.
    return await completeAuthorization(request, authorizedOwnerEmail(request));
  } catch (error) {
    return consentErrorResponse(normalizeOwnerError(error));
  }
}

function normalizeOwnerError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  const code = error.status === 401 || error.status === 403
    ? "access_denied"
    : "server_error";
  return new OAuthError(error.status, code, error.message, error.headers);
}
