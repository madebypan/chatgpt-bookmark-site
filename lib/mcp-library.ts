import {
  AGENT_TOKEN_PREFIX,
  authenticateAgentClient,
} from "@/lib/agent-clients";
import { ApiError } from "@/lib/http";
import { askFileSearchLibrary } from "@/lib/file-search";
import {
  backfillKnowledgeIndex,
  getKnowledgeIndexStatus,
  listRecentKnowledgeBookmarks,
  readKnowledgeBookmark,
  searchKnowledge,
} from "@/lib/knowledge";
import type {
  McpBookmarkDocument,
  McpLibraryAdapter,
  McpLibraryAnswer,
  McpRecentBookmark,
  McpSearchHit,
} from "@/lib/mcp";
import {
  authenticateOauthAccessToken,
  KNOWLEDGE_SCOPE,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAuthError,
} from "@/lib/oauth";

export function createLibraryMcpAdapter(): McpLibraryAdapter {
  return {
    authorize: authorizeMcpRequest,
    isOriginAllowed: isMcpOriginAllowed,
    async searchLibrary({ query, limit }): Promise<McpSearchHit[]> {
      const indexStatus = await getKnowledgeIndexStatus();
      if (!indexStatus.complete) {
        await backfillKnowledgeIndex({ limit: 5 }).catch(() => undefined);
      }
      const response = await searchKnowledge({ query, limit });
      return response.results.map((result) => ({
        id: result.bookmarkId,
        title: result.title || result.siteName || result.sourceUrl,
        url: result.sourceUrl,
        siteName: result.siteName,
        author: result.author,
        createdAt: result.capturedAt,
        snippet: result.matches.map((match) => {
          const heading = match.heading ? `## ${match.heading}\n` : "";
          return `${heading}${match.text}`;
        }).join("\n\n"),
      }));
    },
    async readBookmark({
      bookmarkId,
      fromChunk,
      maxChunks,
    }): Promise<McpBookmarkDocument | null> {
      try {
        const page = await readKnowledgeBookmark({
          id: bookmarkId,
          from: fromChunk,
          limit: maxChunks,
        });
        return {
          id: page.bookmark.id,
          title: page.bookmark.title || page.bookmark.siteName || page.bookmark.sourceUrl,
          url: page.bookmark.sourceUrl,
          canonicalUrl: page.bookmark.sourceUrl,
          description: page.bookmark.description,
          siteName: page.bookmark.siteName,
          author: page.bookmark.author,
          createdAt: page.bookmark.capturedAt,
          updatedAt: page.bookmark.updatedAt,
          revision: page.bookmark.revision,
          chunkCount: page.bookmark.chunkCount,
          indexTruncated: page.bookmark.indexTruncated,
          chunks: page.chunks,
          nextFrom: page.nextFrom,
        };
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    async listRecent({ limit }): Promise<McpRecentBookmark[]> {
      const response = await listRecentKnowledgeBookmarks({ limit });
      return response.bookmarks.map((bookmark) => ({
        id: bookmark.id,
        title: bookmark.title || bookmark.siteName || bookmark.sourceUrl,
        url: bookmark.sourceUrl,
        description: bookmark.description,
        siteName: bookmark.siteName,
        createdAt: bookmark.capturedAt,
        updatedAt: bookmark.updatedAt,
        status: bookmark.searchStatus,
      }));
    },
    async askLibrary({ question }): Promise<McpLibraryAnswer> {
      const localIndex = await getKnowledgeIndexStatus();
      if (!localIndex.complete) {
        await backfillKnowledgeIndex({ limit: 5 }).catch(() => undefined);
      }
      return askFileSearchLibrary(question);
    },
  };
}

async function authorizeMcpRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? "";
  try {
    if (token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
      const access = await authenticateOauthAccessToken(request);
      return {
        authorized: true as const,
        principal: {
          subject: access.ownerEmail,
          clientId: access.clientId,
          scopes: access.scopes,
          credentialType: "oauth",
        },
      };
    }

    if (token.startsWith(AGENT_TOKEN_PREFIX)) {
      const client = await authenticateAgentClient(request, "read");
      return {
        authorized: true as const,
        principal: {
          subject: "owner",
          clientId: client.id,
          scopes: client.scopes,
          credentialType: "manual",
        },
      };
    }
  } catch (error) {
    if (error instanceof ApiError || error instanceof OAuthError) {
      return {
        authorized: false as const,
        status: normalizeAuthorizationStatus(error.status),
        message: error.message,
        headers: error instanceof ApiError ? error.headers : error.headers,
        challenge: authorizationChallenge(request),
      };
    }
    throw error;
  }

  return {
    authorized: false as const,
    status: 401 as const,
    message: "Connect this private library with OAuth or a valid read-only agent key.",
    challenge: authorizationChallenge(request),
  };
}

function normalizeAuthorizationStatus(value: number): 401 | 403 | 429 | 503 {
  if (value === 403 || value === 429 || value === 503) return value;
  return 401;
}

function authorizationChallenge(request: Request): string {
  const origin = new URL(request.url).origin;
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${KNOWLEDGE_SCOPE}"`;
}

function isMcpOriginAllowed(origin: string, request: Request): boolean {
  if (origin === new URL(request.url).origin) return true;
  if (origin === "https://chatgpt.com" || origin === "https://claude.ai") return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}
