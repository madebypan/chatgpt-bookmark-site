const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_API_VERSION = "v1beta";

export type GeminiDiagnosticFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type GeminiEndpointProbe = {
  ok: boolean;
  status: number | null;
  upstreamStatus: string | null;
  category:
    | "ok"
    | "invalid_request"
    | "unauthenticated"
    | "permission_denied"
    | "not_found"
    | "rate_limited"
    | "upstream_failure"
    | "network_error"
    | "request_failed";
};

export type GeminiKeyFormat = "auth_key" | "standard_key" | "unknown";

export type GeminiStoreListSummary = {
  count: number;
  truncated: boolean;
  namedStorePresent: boolean;
};

export type GeminiApiDiagnostic = {
  configured: true;
  credentialAccepted: boolean;
  fileSearchAccessible: boolean;
  keyFormat: GeminiKeyFormat;
  models: GeminiEndpointProbe;
  fileSearchStores: GeminiEndpointProbe;
  storeSummary: GeminiStoreListSummary | null;
  countTokensPost: GeminiEndpointProbe | null;
};

export type GeminiDiagnosticOptions = {
  storeDisplayName?: string;
};

export async function probeGeminiApiKey(
  apiKeyInput: string,
  fetchImpl: GeminiDiagnosticFetch = fetch,
  options: GeminiDiagnosticOptions = {},
): Promise<GeminiApiDiagnostic> {
  const apiKey = apiKeyInput.trim();
  if (!apiKey) throw new Error("Gemini API key is not configured.");

  const [models, stores] = await Promise.all([
    probeEndpoint(fetchImpl, apiKey, `/${GEMINI_API_VERSION}/models?pageSize=50`),
    probeEndpoint(fetchImpl, apiKey, `/${GEMINI_API_VERSION}/fileSearchStores?pageSize=20`),
  ]);

  const countTokensModel = pickCountTokensModel(models.body);
  const countTokensPost = countTokensModel
    ? (await probeEndpoint(
      fetchImpl,
      apiKey,
      `/${GEMINI_API_VERSION}/${countTokensModel}:countTokens`,
      JSON.stringify({ contents: [{ parts: [{ text: "diagnostic ping" }] }] }),
    )).probe
    : null;

  return {
    configured: true,
    credentialAccepted: models.probe.ok,
    fileSearchAccessible: stores.probe.ok,
    keyFormat: classifyKeyFormat(apiKey),
    models: models.probe,
    fileSearchStores: stores.probe,
    storeSummary: summarizeStores(stores.body, options.storeDisplayName ?? ""),
    countTokensPost,
  };
}

// The key format only reveals which vendor-assigned key family is configured
// (Google AI Studio auth keys start with "AQ", legacy standard keys with
// "AIza"); it never exposes any part of the key material itself.
function classifyKeyFormat(apiKey: string): GeminiKeyFormat {
  if (apiKey.startsWith("AIza")) return "standard_key";
  if (/^AQ[A-Za-z0-9._-]{6,}$/.test(apiKey)) return "auth_key";
  return "unknown";
}

function pickCountTokensModel(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const models = Array.isArray(body.models) ? body.models : [];
  for (const entry of models) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const methods = Array.isArray(record.supportedGenerationMethods)
      ? record.supportedGenerationMethods
      : [];
    if (/^models\/[A-Za-z0-9.-]+$/.test(name) && methods.includes("countTokens")) {
      return name;
    }
  }
  return null;
}

function summarizeStores(
  body: Record<string, unknown> | null,
  targetDisplayName: string,
): GeminiStoreListSummary | null {
  if (!body) return null;
  const stores = Array.isArray(body.fileSearchStores) ? body.fileSearchStores : [];
  let namedStorePresent = false;
  for (const entry of stores) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const displayName = (entry as Record<string, unknown>).displayName;
    if (
      Boolean(targetDisplayName) &&
      typeof displayName === "string" &&
      displayName === targetDisplayName
    ) {
      namedStorePresent = true;
      break;
    }
  }
  return {
    count: Math.min(stores.length, 999),
    truncated: typeof body.nextPageToken === "string" && body.nextPageToken.length > 0,
    namedStorePresent,
  };
}

async function probeEndpoint(
  fetchImpl: GeminiDiagnosticFetch,
  apiKey: string,
  path: string,
  postBody?: string,
): Promise<{ probe: GeminiEndpointProbe; body: Record<string, unknown> | null }> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Goog-Api-Key": apiKey,
    };
    if (postBody !== undefined) headers["Content-Type"] = "application/json";
    response = await fetchImpl(`${GEMINI_ORIGIN}${path}`, {
      method: postBody === undefined ? "GET" : "POST",
      headers,
      ...(postBody === undefined ? {} : { body: postBody }),
    });
  } catch {
    return {
      probe: {
        ok: false,
        status: null,
        upstreamStatus: null,
        category: "network_error",
      },
      body: null,
    };
  }

  if (response.ok) {
    return {
      probe: {
        ok: true,
        status: response.status,
        upstreamStatus: null,
        category: "ok",
      },
      body: await readJsonRecord(response),
    };
  }

  const upstreamStatus = await readUpstreamStatus(response);
  return {
    probe: {
      ok: false,
      status: response.status,
      upstreamStatus,
      category: classifyFailure(response.status, upstreamStatus),
    },
    body: null,
  };
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text();
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function readUpstreamStatus(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { error?: { status?: unknown } };
    const value = body?.error?.status;
    if (typeof value !== "string") return null;
    const normalized = value.trim().toUpperCase();
    return /^[A-Z_]{2,40}$/.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function classifyFailure(
  status: number,
  upstreamStatus: string | null,
): GeminiEndpointProbe["category"] {
  if (status === 401 || upstreamStatus === "UNAUTHENTICATED") return "unauthenticated";
  if (status === 403 || upstreamStatus === "PERMISSION_DENIED") return "permission_denied";
  if (status === 404 || upstreamStatus === "NOT_FOUND") return "not_found";
  if (status === 429 || upstreamStatus === "RESOURCE_EXHAUSTED") return "rate_limited";
  if (status >= 500) return "upstream_failure";
  if (status === 400 || upstreamStatus === "INVALID_ARGUMENT") return "invalid_request";
  return "request_failed";
}
