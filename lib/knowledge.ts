import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  bookmarkChunks,
  bookmarks,
  type Bookmark,
  type NewBookmarkChunk,
} from "@/db/schema";
import { queueFileSearchDocument } from "@/lib/file-search";
import { buildFtsMatchQuery } from "@/lib/fts";
import { ApiError } from "@/lib/http";
import { getArchiveText } from "@/lib/storage";

export const KNOWLEDGE_INDEX_VERSION = 1;
export const KNOWLEDGE_CHUNK_TARGET = 1_600;
export const KNOWLEDGE_CHUNK_OVERLAP = 160;
// Ten rows fit D1's 100-bound-parameter ceiling per INSERT. Keeping the cap at
// 360 leaves headroom under the free-tier 50-query invocation limit for the
// capture, token-authentication, activation, and cleanup queries around it.
export const KNOWLEDGE_MAX_CHUNKS = 360;

const INSERT_BATCH_SIZE = 10;
const MAX_SEARCH_TERMS = 6;
const MAX_SEARCH_RESULTS = 20;
const MAX_MATCHES_PER_RESULT = 2;
const MAX_READ_CHUNKS = 8;
const SNIPPET_LENGTH = 600;

export type MarkdownChunk = {
  ordinal: number;
  heading: string;
  content: string;
};

export type ChunkedMarkdown = {
  chunks: MarkdownChunk[];
  truncated: boolean;
};

export type KnowledgeMatch = {
  chunkId: string;
  ordinal: number;
  heading: string;
  text: string;
};

export type KnowledgeSearchResult = {
  bookmarkId: string;
  revision: string;
  title: string;
  sourceUrl: string;
  siteName: string;
  author: string;
  capturedAt: string;
  updatedAt: string;
  score: number;
  matches: KnowledgeMatch[];
};

type KnowledgeSearchRow = {
  bookmarkId: string;
  revision: string;
  title: string;
  url: string;
  canonicalUrl: string;
  siteName: string;
  author: string;
  capturedAt: string;
  updatedAt: string;
  chunkId: string;
  ordinal: number;
  heading: string;
  content: string;
  score: number;
};

export type KnowledgeBookmarkPage = {
  bookmark: {
    id: string;
    revision: string;
    title: string;
    sourceUrl: string;
    siteName: string;
    author: string;
    description: string;
    capturedAt: string;
    updatedAt: string;
    chunkCount: number;
    indexTruncated: boolean;
  };
  chunks: KnowledgeMatch[];
  nextFrom: number | null;
};

export type RecentKnowledgeCursor = {
  createdAt: string;
  id: string;
};

export type RecentKnowledgeResult = {
  bookmarks: Array<{
    id: string;
    title: string;
    sourceUrl: string;
    siteName: string;
    author: string;
    description: string;
    capturedAt: string;
    updatedAt: string;
    searchStatus: string;
    chunkCount: number;
  }>;
  nextCursor: RecentKnowledgeCursor | null;
};

/**
 * Deterministically divides Markdown into paragraph-aware, overlapping chunks.
 * R2 remains the complete source; this output is a disposable D1 search mirror.
 */
export function chunkMarkdown(
  markdown: string,
  options: {
    targetLength?: number;
    overlap?: number;
    maxChunks?: number;
  } = {},
): ChunkedMarkdown {
  const targetLength = clampInteger(
    options.targetLength,
    KNOWLEDGE_CHUNK_TARGET,
    400,
    8_000,
  );
  const overlap = clampInteger(
    options.overlap,
    KNOWLEDGE_CHUNK_OVERLAP,
    0,
    Math.floor(targetLength / 3),
  );
  const maxChunks = clampInteger(
    options.maxChunks,
    KNOWLEDGE_MAX_CHUNKS,
    1,
    KNOWLEDGE_MAX_CHUNKS,
  );
  const normalized = normalizeMarkdown(markdown);
  if (!normalized) return { chunks: [], truncated: false };

  const units = markdownUnits(normalized);
  const chunks: MarkdownChunk[] = [];
  let currentContent = "";
  let currentHeading = "";
  let truncated = false;

  const pushChunk = () => {
    const content = currentContent.trim();
    if (!content) return true;
    if (chunks.length >= maxChunks) {
      truncated = true;
      return false;
    }
    chunks.push({
      ordinal: chunks.length,
      heading: currentHeading,
      content,
    });
    return true;
  };

  outer: for (const unit of units) {
    const pieces = splitLongText(unit.content, targetLength, overlap);
    for (const piece of pieces) {
      if (!currentContent) {
        currentContent = piece;
        currentHeading = unit.heading;
        continue;
      }

      const combined = `${currentContent}\n\n${piece}`;
      if (combined.length <= targetLength) {
        currentContent = combined;
        if (!currentHeading) currentHeading = unit.heading;
        continue;
      }

      const previous = currentContent;
      if (!pushChunk()) break outer;
      const availableOverlap = Math.max(0, targetLength - piece.length - 2);
      const overlapText = availableOverlap
        ? tailForOverlap(previous, Math.min(overlap, availableOverlap))
        : "";
      currentContent = overlapText ? `${overlapText}\n\n${piece}` : piece;
      currentHeading = unit.heading;
    }
  }

  if (!truncated && currentContent.trim()) pushChunk();
  return { chunks, truncated };
}

export async function indexBookmarkContent(
  bookmark: Bookmark,
  markdown: string,
): Promise<{
  revision: string;
  chunkCount: number;
  truncated: boolean;
  reused: boolean;
}> {
  const searchableMarkdown = markdown.trim() || fallbackSearchDocument(bookmark);
  const sourceRevision = await knowledgeSourceRevision(bookmark, searchableMarkdown);
  const revision = await knowledgeRevision(sourceRevision);
  if (
    bookmark.searchStatus === "ready" &&
    bookmark.searchVersion === KNOWLEDGE_INDEX_VERSION &&
    bookmark.searchContentHash === revision
  ) {
    if (bookmark.sourceRevision !== sourceRevision) {
      await getDb().update(bookmarks).set({ sourceRevision })
        .where(eq(bookmarks.id, bookmark.id));
    }
    await queueFileSearchDocument({
      bookmarkId: bookmark.id,
      revision: sourceRevision,
      displayName: bookmark.title || bookmark.siteName || bookmark.id,
    }).catch(() => undefined);
    return {
      revision,
      chunkCount: bookmark.searchChunkCount,
      truncated: Boolean(bookmark.searchTruncated),
      reused: true,
    };
  }

  const chunked = chunkMarkdown(searchableMarkdown);
  const now = new Date().toISOString();
  const rows: NewBookmarkChunk[] = chunked.chunks.map((chunk) => ({
    id: `${bookmark.id}:${revision}:${chunk.ordinal}`,
    bookmarkId: bookmark.id,
    revision,
    ordinal: chunk.ordinal,
    title: bookmark.title,
    siteName: bookmark.siteName,
    author: bookmark.author,
    heading: chunk.heading,
    content: chunk.content,
    createdAt: now,
  }));
  const db = getDb();

  try {
    // A failed earlier attempt may have left an inactive partial revision.
    await db.delete(bookmarkChunks).where(and(
      eq(bookmarkChunks.bookmarkId, bookmark.id),
      eq(bookmarkChunks.revision, revision),
    ));

    for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
      await db.insert(bookmarkChunks)
        .values(rows.slice(offset, offset + INSERT_BATCH_SIZE));
    }

    const [activated] = await db.update(bookmarks).set({
      searchStatus: "ready",
      searchVersion: KNOWLEDGE_INDEX_VERSION,
      searchContentHash: revision,
      searchChunkCount: rows.length,
      searchIndexedAt: now,
      searchIndexError: null,
      searchTruncated: chunked.truncated ? 1 : 0,
      sourceRevision,
    }).where(eq(bookmarks.id, bookmark.id)).returning({ id: bookmarks.id });
    if (!activated) throw new Error("Bookmark disappeared while its search index was being activated.");

    // Cleanup is deliberately after activation. Search always joins the active
    // revision, so a failed cleanup cannot expose stale chunks.
    await db.delete(bookmarkChunks).where(and(
      eq(bookmarkChunks.bookmarkId, bookmark.id),
      ne(bookmarkChunks.revision, revision),
    )).catch(() => undefined);

    await queueFileSearchDocument({
      bookmarkId: bookmark.id,
      revision: sourceRevision,
      displayName: bookmark.title || bookmark.siteName || bookmark.id,
    }).catch(() => undefined);

    return {
      revision,
      chunkCount: rows.length,
      truncated: chunked.truncated,
      reused: false,
    };
  } catch (error) {
    const previousIndexIsUsable = Boolean(bookmark.searchContentHash);
    await db.update(bookmarks).set({
      searchStatus: previousIndexIsUsable ? "ready" : "failed",
      searchIndexError: safeIndexError(error),
      searchIndexedAt: new Date().toISOString(),
    }).where(eq(bookmarks.id, bookmark.id)).catch(() => undefined);
    throw error;
  }
}

export async function deleteBookmarkIndex(bookmarkId: string): Promise<void> {
  await getDb().delete(bookmarkChunks)
    .where(eq(bookmarkChunks.bookmarkId, bookmarkId));
}

export async function searchKnowledge(input: {
  query: string;
  limit?: number;
  siteName?: string;
  after?: string;
  before?: string;
}): Promise<{
  query: string;
  indexVersion: number;
  results: KnowledgeSearchResult[];
}> {
  const query = normalizeSearchQuery(input.query);
  const terms = searchTerms(query);
  const limit = clampInteger(input.limit, 8, 1, MAX_SEARCH_RESULTS);
  const ftsQuery = buildFtsMatchQuery(query);
  if (ftsQuery) {
    try {
      const rows = await searchKnowledgeFtsRows(input, ftsQuery, limit);
      return {
        query,
        indexVersion: KNOWLEDGE_INDEX_VERSION,
        results: groupKnowledgeRows(rows, terms, limit),
      };
    } catch {
      // Deployments apply the FTS migration before serving traffic. Falling
      // back keeps search available during local development or a delayed
      // migration without exposing database errors to MCP clients.
    }
  }
  return searchKnowledgeSubstring(input, query, terms, limit);
}

async function searchKnowledgeSubstring(
  input: {
    query: string;
    limit?: number;
    siteName?: string;
    after?: string;
    before?: string;
  },
  query: string,
  terms: string[],
  limit: number,
): Promise<{
  query: string;
  indexVersion: number;
  results: KnowledgeSearchResult[];
}> {
  const matchConditions = terms.map((term) => or(
    contains(bookmarkChunks.title, term),
    contains(bookmarkChunks.siteName, term),
    contains(bookmarkChunks.author, term),
    contains(bookmarkChunks.heading, term),
    contains(bookmarkChunks.content, term),
  ));
  const scoreParts = terms.map((term) => sql<number>`(
    CASE WHEN ${contains(bookmarkChunks.title, term)} THEN 12 ELSE 0 END +
    CASE WHEN ${contains(bookmarkChunks.heading, term)} THEN 6 ELSE 0 END +
    CASE WHEN ${contains(bookmarkChunks.siteName, term)} THEN 4 ELSE 0 END +
    CASE WHEN ${contains(bookmarkChunks.author, term)} THEN 3 ELSE 0 END +
    CASE WHEN ${contains(bookmarkChunks.content, term)} THEN 1 ELSE 0 END
  )`);
  const score = sql<number>`(${sql.join(scoreParts, sql.raw(" + "))})`;
  const filters = [
    eq(bookmarkChunks.revision, bookmarks.searchContentHash),
    eq(bookmarks.searchStatus, "ready"),
    or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")),
    or(...matchConditions),
  ];

  const siteName = input.siteName?.trim();
  if (siteName) filters.push(eq(bookmarks.siteName, siteName.slice(0, 300)));
  if (input.after) filters.push(sql`${bookmarks.createdAt} >= ${validIsoDate(input.after, "after")}`);
  if (input.before) filters.push(sql`${bookmarks.createdAt} < ${validIsoDate(input.before, "before")}`);

  const rows = await getDb().select({
    bookmarkId: bookmarks.id,
    revision: bookmarkChunks.revision,
    title: bookmarks.title,
    url: bookmarks.url,
    canonicalUrl: bookmarks.canonicalUrl,
    siteName: bookmarks.siteName,
    author: bookmarks.author,
    capturedAt: bookmarks.createdAt,
    updatedAt: bookmarks.updatedAt,
    chunkId: bookmarkChunks.id,
    ordinal: bookmarkChunks.ordinal,
    heading: bookmarkChunks.heading,
    content: bookmarkChunks.content,
    score,
  }).from(bookmarkChunks)
    .innerJoin(bookmarks, eq(bookmarkChunks.bookmarkId, bookmarks.id))
    .where(and(...filters))
    .orderBy(desc(score), desc(bookmarks.createdAt), asc(bookmarkChunks.ordinal))
    .limit(Math.min(80, limit * 8));

  return {
    query,
    indexVersion: KNOWLEDGE_INDEX_VERSION,
    results: groupKnowledgeRows(rows, terms, limit),
  };
}

async function searchKnowledgeFtsRows(
  input: { siteName?: string; after?: string; before?: string },
  ftsQuery: string,
  limit: number,
): Promise<KnowledgeSearchRow[]> {
  const filters = [
    "bookmark_chunks_fts MATCH ?",
    "chunks.revision = saved.search_content_hash",
    "saved.search_status = 'ready'",
    "saved.status IN ('ready', 'partial')",
  ];
  const values: unknown[] = [ftsQuery];
  const siteName = input.siteName?.trim();
  if (siteName) {
    filters.push("saved.site_name = ?");
    values.push(siteName.slice(0, 300));
  }
  if (input.after) {
    filters.push("saved.created_at >= ?");
    values.push(validIsoDate(input.after, "after"));
  }
  if (input.before) {
    filters.push("saved.created_at < ?");
    values.push(validIsoDate(input.before, "before"));
  }
  values.push(Math.min(80, limit * 8));
  const result = await env.DB.prepare(`
    SELECT
      saved.id AS bookmarkId,
      chunks.revision AS revision,
      saved.title AS title,
      saved.url AS url,
      saved.canonical_url AS canonicalUrl,
      saved.site_name AS siteName,
      saved.author AS author,
      saved.created_at AS capturedAt,
      saved.updated_at AS updatedAt,
      chunks.id AS chunkId,
      chunks.ordinal AS ordinal,
      chunks.heading AS heading,
      chunks.content AS content,
      -bm25(bookmark_chunks_fts, 12.0, 4.0, 3.0, 6.0, 1.0) AS score
    FROM bookmark_chunks_fts
    INNER JOIN bookmark_chunks AS chunks
      ON chunks.rowid = bookmark_chunks_fts.rowid
    INNER JOIN bookmarks AS saved
      ON saved.id = chunks.bookmark_id
    WHERE ${filters.join(" AND ")}
    ORDER BY score DESC, saved.created_at DESC, chunks.ordinal ASC
    LIMIT ?
  `).bind(...values).all<KnowledgeSearchRow>();
  return result.results ?? [];
}

function groupKnowledgeRows(
  rows: KnowledgeSearchRow[],
  terms: string[],
  limit: number,
): KnowledgeSearchResult[] {
  const grouped = new Map<string, KnowledgeSearchResult>();
  for (const row of rows) {
    let result = grouped.get(row.bookmarkId);
    if (!result) {
      if (grouped.size >= limit) continue;
      result = {
        bookmarkId: row.bookmarkId,
        revision: row.revision,
        title: row.title,
        sourceUrl: row.canonicalUrl || row.url,
        siteName: row.siteName,
        author: row.author,
        capturedAt: row.capturedAt,
        updatedAt: row.updatedAt,
        score: Number(row.score) || 0,
        matches: [],
      };
      grouped.set(row.bookmarkId, result);
    }
    if (result.matches.length < MAX_MATCHES_PER_RESULT) {
      result.matches.push({
        chunkId: row.chunkId,
        ordinal: Number(row.ordinal) || 0,
        heading: row.heading,
        text: makeSnippet(row.content, terms, SNIPPET_LENGTH),
      });
    }
  }
  return [...grouped.values()];
}

export async function readKnowledgeBookmark(input: {
  id: string;
  from?: number;
  limit?: number;
}): Promise<KnowledgeBookmarkPage> {
  const id = normalizedId(input.id);
  const from = clampInteger(input.from, 0, 0, 100_000);
  const limit = clampInteger(input.limit, 4, 1, MAX_READ_CHUNKS);
  const [bookmark] = await getDb().select().from(bookmarks).where(and(
    eq(bookmarks.id, id),
    or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")),
  )).limit(1);
  if (!bookmark) throw new ApiError(404, "Knowledge bookmark not found.");

  let revision = bookmark.searchContentHash ?? "";
  let indexTruncated = Boolean(bookmark.searchTruncated);
  let page: MarkdownChunk[];
  let chunkCount: number;
  let nextFrom: number | null;
  if (revision && bookmark.searchStatus === "ready") {
    const rows = await getDb().select({
      ordinal: bookmarkChunks.ordinal,
      heading: bookmarkChunks.heading,
      content: bookmarkChunks.content,
    }).from(bookmarkChunks).where(and(
      eq(bookmarkChunks.bookmarkId, bookmark.id),
      eq(bookmarkChunks.revision, revision),
    )).orderBy(asc(bookmarkChunks.ordinal)).limit(limit + 1).offset(from);
    const hasMore = rows.length > limit;
    page = hasMore ? rows.slice(0, limit) : rows;
    chunkCount = bookmark.searchChunkCount;
    nextFrom = hasMore ? from + page.length : null;
  } else {
    const markdown = bookmark.markdownKey
      ? await getArchiveText(bookmark.markdownKey)
      : null;
    const source = markdown?.trim() || fallbackSearchDocument(bookmark);
    const chunked = chunkMarkdown(source);
    chunkCount = chunked.chunks.length;
    page = chunked.chunks.slice(from, from + limit);
    nextFrom = from + page.length < chunkCount ? from + page.length : null;
    revision = await knowledgeRevision(await knowledgeSourceRevision(bookmark, source));
    indexTruncated = chunked.truncated;
  }
  return {
    bookmark: {
      id: bookmark.id,
      revision,
      title: bookmark.title,
      sourceUrl: bookmark.canonicalUrl || bookmark.url,
      siteName: bookmark.siteName,
      author: bookmark.author,
      description: bookmark.description,
      capturedAt: bookmark.createdAt,
      updatedAt: bookmark.updatedAt,
      chunkCount,
      indexTruncated,
    },
    chunks: page.map((chunk) => ({
      chunkId: `${bookmark.id}:${revision}:${chunk.ordinal}`,
      ordinal: chunk.ordinal,
      heading: chunk.heading,
      text: chunk.content,
    })),
    nextFrom,
  };
}

export async function listRecentKnowledgeBookmarks(input: {
  limit?: number;
  cursor?: RecentKnowledgeCursor;
} = {}): Promise<RecentKnowledgeResult> {
  const limit = clampInteger(input.limit, 10, 1, 50);
  const filters = [
    or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")),
  ];
  if (input.cursor) {
    const createdAt = validIsoDate(input.cursor.createdAt, "cursor.createdAt");
    const id = normalizedId(input.cursor.id);
    filters.push(or(
      lt(bookmarks.createdAt, createdAt),
      and(eq(bookmarks.createdAt, createdAt), lt(bookmarks.id, id)),
    ));
  }

  const rows = await getDb().select({
    id: bookmarks.id,
    title: bookmarks.title,
    url: bookmarks.url,
    canonicalUrl: bookmarks.canonicalUrl,
    siteName: bookmarks.siteName,
    author: bookmarks.author,
    description: bookmarks.description,
    createdAt: bookmarks.createdAt,
    updatedAt: bookmarks.updatedAt,
    searchStatus: bookmarks.searchStatus,
    searchChunkCount: bookmarks.searchChunkCount,
  }).from(bookmarks)
    .where(and(...filters))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);

  return {
    bookmarks: visible.map((bookmark) => ({
      id: bookmark.id,
      title: bookmark.title,
      sourceUrl: bookmark.canonicalUrl || bookmark.url,
      siteName: bookmark.siteName,
      author: bookmark.author,
      description: bookmark.description,
      capturedAt: bookmark.createdAt,
      updatedAt: bookmark.updatedAt,
      searchStatus: bookmark.searchStatus,
      chunkCount: bookmark.searchChunkCount,
    })),
    nextCursor: hasMore && last
      ? { createdAt: last.createdAt, id: last.id }
      : null,
  };
}

export async function backfillKnowledgeIndex(input: {
  limit?: number;
} = {}): Promise<{
  attempted: number;
  indexed: number;
  failed: Array<{ id: string; error: string }>;
}> {
  const limit = clampInteger(input.limit, 3, 1, 5);
  const candidates = await getDb().select().from(bookmarks).where(and(
    or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")),
    or(
      ne(bookmarks.searchStatus, "ready"),
      ne(bookmarks.searchVersion, KNOWLEDGE_INDEX_VERSION),
      isNull(bookmarks.searchContentHash),
      isNull(bookmarks.sourceRevision),
      isNotNull(bookmarks.searchIndexError),
    ),
  )).orderBy(
    asc(sql`CASE WHEN ${bookmarks.searchStatus} = 'pending' THEN 0 ELSE 1 END`),
    asc(sql`coalesce(${bookmarks.searchIndexedAt}, ${bookmarks.createdAt})`),
    asc(bookmarks.id),
  ).limit(limit);
  const failed: Array<{ id: string; error: string }> = [];
  let indexed = 0;

  for (const bookmark of candidates) {
    try {
      const markdown = bookmark.markdownKey
        ? await getArchiveText(bookmark.markdownKey)
        : null;
      await indexBookmarkContent(
        bookmark,
        markdown?.trim() || fallbackSearchDocument(bookmark),
      );
      indexed += 1;
    } catch (error) {
      failed.push({ id: bookmark.id, error: safeIndexError(error) });
    }
  }

  return { attempted: candidates.length, indexed, failed };
}

export async function getKnowledgeIndexStatus(): Promise<{
  total: number;
  indexed: number;
  pending: number;
  failed: number;
  complete: boolean;
}> {
  const [row] = await getDb().select({
    total: count(),
    indexed: sql<number>`sum(CASE WHEN
      ${bookmarks.searchStatus} = 'ready'
      AND ${bookmarks.searchVersion} = ${KNOWLEDGE_INDEX_VERSION}
      AND ${bookmarks.searchContentHash} IS NOT NULL
      AND ${bookmarks.sourceRevision} IS NOT NULL
      AND ${bookmarks.searchIndexError} IS NULL
      THEN 1 ELSE 0 END)`,
    failed: sql<number>`sum(CASE WHEN
      ${bookmarks.searchStatus} = 'failed' OR ${bookmarks.searchIndexError} IS NOT NULL
      THEN 1 ELSE 0 END)`,
  }).from(bookmarks).where(
    or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")),
  );
  const total = Number(row?.total) || 0;
  const indexed = Number(row?.indexed) || 0;
  const failed = Number(row?.failed) || 0;
  const pending = Math.max(0, total - indexed - failed);
  return {
    total,
    indexed,
    pending,
    failed,
    complete: indexed === total,
  };
}

function markdownUnits(markdown: string): Array<{ heading: string; content: string }> {
  const units: Array<{ heading: string; content: string }> = [];
  let heading = "";
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) units.push({ heading, content });
    buffer = [];
  };

  for (const line of markdown.split("\n")) {
    const fenceMatch = line.trim().match(/^(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      buffer.push(line);
      continue;
    }

    const headingMatch = !fence ? line.match(/^#{1,6}\s+(.+?)\s*#*$/) : null;
    if (headingMatch) {
      flush();
      heading = headingMatch[1].trim();
      buffer.push(line);
      flush();
      continue;
    }

    if (!fence && !line.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return units;
}

function splitLongText(text: string, targetLength: number, overlap: number): string[] {
  if (text.length <= targetLength) return [text];
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + targetLength);
    if (end < text.length) {
      const minimumEnd = start + Math.floor(targetLength * 0.6);
      const newline = text.lastIndexOf("\n", end);
      const space = text.lastIndexOf(" ", end);
      const boundary = Math.max(newline, space);
      if (boundary >= minimumEnd) end = boundary;
    }
    const piece = text.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= text.length) break;
    const next = Math.max(start + 1, end - overlap);
    start = next;
  }
  return pieces;
}

function tailForOverlap(text: string, maximum: number): string {
  if (!maximum || !text) return "";
  const raw = text.slice(-maximum);
  const boundary = Math.max(raw.indexOf("\n"), raw.indexOf(" "));
  return (boundary >= 0 ? raw.slice(boundary + 1) : raw).trim();
}

export async function knowledgeSourceRevision(
  bookmark: Bookmark,
  markdown: string,
): Promise<string> {
  const input = JSON.stringify([
    bookmark.title,
    bookmark.siteName,
    bookmark.author,
    bookmark.canonicalUrl || bookmark.url,
    bookmark.contentType,
    markdown,
  ]);
  return sha256Hex(input);
}

async function knowledgeRevision(sourceRevision: string): Promise<string> {
  return sha256Hex(JSON.stringify([KNOWLEDGE_INDEX_VERSION, sourceRevision]));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

function fallbackSearchDocument(bookmark: Bookmark): string {
  return [
    `# ${bookmark.title || bookmark.siteName || bookmark.url}`,
    `Source: ${bookmark.canonicalUrl || bookmark.url}`,
    bookmark.author ? `Author: ${bookmark.author}` : "",
    bookmark.description,
    bookmark.excerpt,
  ].filter(Boolean).join("\n\n");
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
}

function normalizeSearchQuery(value: string): string {
  if (typeof value !== "string") throw new ApiError(400, "A search query is required.");
  const query = value.replace(/\s+/g, " ").trim();
  if (!query) throw new ApiError(400, "A search query is required.");
  if ([...query].length > 200) throw new ApiError(400, "The search query is too long.");
  return query;
}

function searchTerms(query: string): string[] {
  const normalized = query.toLocaleLowerCase("und");
  const pieces = normalized.split(/\s+/u).filter(Boolean);
  return [...new Set(pieces.length > 1 ? [normalized, ...pieces] : pieces)]
    .slice(0, MAX_SEARCH_TERMS);
}

function contains(column: unknown, term: string) {
  return sql<boolean>`instr(lower(${column}), ${term}) > 0`;
}

function makeSnippet(content: string, terms: string[], maximum: number): string {
  if (content.length <= maximum) return content;
  const normalized = content.toLocaleLowerCase("und");
  const indexes = terms.map((term) => normalized.indexOf(term)).filter((value) => value >= 0);
  const match = indexes.length ? Math.min(...indexes) : 0;
  const start = Math.max(0, match - Math.floor(maximum * 0.28));
  const end = Math.min(content.length, start + maximum);
  return `${start ? "…" : ""}${content.slice(start, end).trim()}${end < content.length ? "…" : ""}`;
}

function normalizedId(value: string): string {
  if (typeof value !== "string") throw new ApiError(400, "A valid bookmark id is required.");
  const id = value.trim();
  if (!id || id.length > 160) throw new ApiError(400, "A valid bookmark id is required.");
  return id;
}

function validIsoDate(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new ApiError(400, `${field} must be a valid date.`);
  return new Date(timestamp).toISOString();
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value as number)));
}

function safeIndexError(error: unknown): string {
  const value = error instanceof Error ? error.message : "The knowledge index could not be built.";
  return value.replace(/\s+/g, " ").trim().slice(0, 500) || "The knowledge index could not be built.";
}
