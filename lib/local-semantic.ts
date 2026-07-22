import { env } from "cloudflare:workers";
import {
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  GeminiFileSearchError,
  type GeminiEvidence,
  createGeminiFileSearchClient,
} from "@/lib/gemini-file-search-client";
import { cosineSimilarity } from "@/lib/vector";

const STATE_ID = "primary";
const PAGE_SIZE = 250;
const REFUSAL_TEXT = "收藏中找不到足夠資料回答這個問題。";

type GeminiClient = ReturnType<typeof createGeminiFileSearchClient>;

export type LocalSemanticIndexStatus = {
  active: boolean;
  total: number;
  indexed: number;
  pending: number;
  indexing: number;
  failed: number;
  complete: boolean;
  error: string | null;
  storeReady: boolean;
};

export type LocalSemanticCitation = {
  citationId: string;
  bookmarkId: string;
  revision: string;
  title: string;
  url: string;
  excerpt: string;
  pageNumber: null;
  claims: string[];
};

export type LocalSemanticAnswer = {
  answer: string;
  citations: LocalSemanticCitation[];
};

type StatusRow = {
  total?: number | string;
  indexed?: number | string;
  embedded_chunks?: number | string;
};

type StateRow = {
  active?: number | string;
  last_error?: string | null;
};

type CandidateRow = {
  chunk_id: string;
  bookmark_id: string;
  revision: string;
  title: string;
  site_name: string;
  heading: string;
  content: string;
};

type SearchRow = CandidateRow & {
  canonical_url: string;
  ordinal: number | string;
  vector: string;
};

type SemanticHit = SearchRow & { score: number };

export async function getLocalSemanticIndexStatus(): Promise<LocalSemanticIndexStatus> {
  const db = env.DB;
  const [counts, state] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN chunk_count > 0 AND embedded_count = chunk_count THEN 1 ELSE 0 END) AS indexed,
        SUM(embedded_count) AS embedded_chunks
      FROM (
        SELECT
          b.id,
          COUNT(c.id) AS chunk_count,
          SUM(CASE WHEN e.chunk_id IS NOT NULL THEN 1 ELSE 0 END) AS embedded_count
        FROM bookmarks AS b
        LEFT JOIN bookmark_chunks AS c
          ON c.bookmark_id = b.id
          AND c.revision = b.search_content_hash
        LEFT JOIN semantic_embeddings AS e
          ON e.chunk_id = c.id
          AND e.model = ?
          AND e.dimensions = ?
        WHERE b.status IN ('ready', 'partial')
        GROUP BY b.id
      )
    `).bind(GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_DIMENSIONS).first<StatusRow>(),
    db.prepare(`
      SELECT active, last_error
      FROM semantic_index_state
      WHERE id = ?
      LIMIT 1
    `).bind(STATE_ID).first<StateRow>(),
  ]);
  const total = numeric(counts?.total);
  const indexed = numeric(counts?.indexed);
  const embeddedChunks = numeric(counts?.embedded_chunks);
  const active = numeric(state?.active) === 1 || embeddedChunks > 0;
  const error = safeStoredError(state?.last_error);
  const failed = error ? Math.min(1, Math.max(0, total - indexed)) : 0;
  return {
    active,
    total,
    indexed,
    pending: Math.max(0, total - indexed - failed),
    indexing: 0,
    failed,
    complete: active && indexed === total,
    error,
    storeReady: active && embeddedChunks > 0,
  };
}

export async function advanceLocalSemanticIndex(
  client: GeminiClient,
  limit: number,
): Promise<LocalSemanticIndexStatus> {
  const db = env.DB;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO semantic_index_state (id, active, last_error, created_at, updated_at)
    VALUES (?, 1, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET active = 1, updated_at = excluded.updated_at
  `).bind(STATE_ID, now, now).run();

  const candidates = await db.prepare(`
    SELECT
      c.id AS chunk_id,
      c.bookmark_id,
      c.revision,
      c.title,
      c.site_name,
      c.heading,
      c.content
    FROM bookmark_chunks AS c
    INNER JOIN bookmarks AS b
      ON b.id = c.bookmark_id
      AND b.search_content_hash = c.revision
    LEFT JOIN semantic_embeddings AS e
      ON e.chunk_id = c.id
      AND e.model = ?
      AND e.dimensions = ?
    WHERE b.status IN ('ready', 'partial')
      AND b.search_status = 'ready'
      AND e.chunk_id IS NULL
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT ?
  `).bind(
    GEMINI_EMBEDDING_MODEL,
    GEMINI_EMBEDDING_DIMENSIONS,
    clamp(limit, 1, 5),
  ).all<CandidateRow>();

  for (const row of candidates.results ?? []) {
    try {
      const title = row.heading || row.title || row.site_name || "none";
      const vector = await client.embedText(`title: ${title} | text: ${row.content}`);
      const updatedAt = new Date().toISOString();
      await db.prepare(`
        INSERT INTO semantic_embeddings (
          chunk_id, bookmark_id, revision, model, dimensions, vector, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          bookmark_id = excluded.bookmark_id,
          revision = excluded.revision,
          model = excluded.model,
          dimensions = excluded.dimensions,
          vector = excluded.vector,
          updated_at = excluded.updated_at
      `).bind(
        row.chunk_id,
        row.bookmark_id,
        row.revision,
        GEMINI_EMBEDDING_MODEL,
        GEMINI_EMBEDDING_DIMENSIONS,
        serializeVector(vector),
        updatedAt,
        updatedAt,
      ).run();
      await updateStateError(null);
    } catch (error) {
      await updateStateError(safeSemanticError(error));
      break;
    }
  }
  return getLocalSemanticIndexStatus();
}

export async function askLocalSemanticLibrary(
  client: GeminiClient,
  questionInput: string,
): Promise<LocalSemanticAnswer | null> {
  const question = questionInput.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, 2_000);
  if (!question) return null;
  const queryVector = await client.embedText(`task: question answering | query: ${question}`);
  const hits = await nearestChunks(queryVector, 12);
  if (hits.length === 0) return null;

  const evidence: GeminiEvidence[] = hits.map((hit, index) => ({
    id: `S${index + 1}`,
    title: hit.title || hit.site_name || hit.canonical_url,
    text: hit.heading ? `## ${hit.heading}\n${hit.content}` : hit.content,
    url: hit.canonical_url,
  }));
  const answer = await client.answerWithEvidence(question, evidence);
  if (!answer.answer || answer.answer.includes(REFUSAL_TEXT) || answer.citationIds.length === 0) {
    return null;
  }
  const citationById = new Map(evidence.map((item, index) => [item.id, { item, hit: hits[index] }]));
  const citations = answer.citationIds.flatMap((id, index) => {
    const source = citationById.get(id);
    if (!source) return [];
    return [{
      citationId: `S${index + 1}`,
      bookmarkId: source.hit.bookmark_id,
      revision: source.hit.revision,
      title: source.item.title,
      url: source.hit.canonical_url,
      excerpt: source.item.text.slice(0, 800),
      pageNumber: null,
      claims: [answer.answer.slice(0, 2_000)],
    } satisfies LocalSemanticCitation];
  });
  return citations.length ? { answer: answer.answer, citations } : null;
}

async function nearestChunks(queryVector: number[], limit: number): Promise<SemanticHit[]> {
  const db = env.DB;
  const top: SemanticHit[] = [];
  let cursor = "";
  while (true) {
    const page = await db.prepare(`
      SELECT
        c.id AS chunk_id,
        c.bookmark_id,
        c.revision,
        c.ordinal,
        c.title,
        c.site_name,
        c.heading,
        c.content,
        b.canonical_url,
        e.vector
      FROM semantic_embeddings AS e
      INNER JOIN bookmark_chunks AS c ON c.id = e.chunk_id
      INNER JOIN bookmarks AS b
        ON b.id = c.bookmark_id
        AND b.search_content_hash = c.revision
      WHERE e.model = ?
        AND e.dimensions = ?
        AND c.id > ?
        AND b.status IN ('ready', 'partial')
        AND NOT EXISTS (
          SELECT 1
          FROM bookmark_chunks AS missing_chunk
          LEFT JOIN semantic_embeddings AS missing_embedding
            ON missing_embedding.chunk_id = missing_chunk.id
            AND missing_embedding.model = ?
            AND missing_embedding.dimensions = ?
          WHERE missing_chunk.bookmark_id = b.id
            AND missing_chunk.revision = b.search_content_hash
            AND missing_embedding.chunk_id IS NULL
        )
      ORDER BY c.id ASC
      LIMIT ?
    `).bind(
      GEMINI_EMBEDDING_MODEL,
      GEMINI_EMBEDDING_DIMENSIONS,
      cursor,
      GEMINI_EMBEDDING_MODEL,
      GEMINI_EMBEDDING_DIMENSIONS,
      PAGE_SIZE,
    ).all<SearchRow>();
    const rows = page.results ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row.chunk_id;
      const vector = parseVector(row.vector);
      if (!vector) continue;
      insertTop(top, { ...row, score: cosineSimilarity(queryVector, vector) }, limit * 3);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  const perBookmark = new Map<string, number>();
  return top.filter((hit) => {
    const count = perBookmark.get(hit.bookmark_id) ?? 0;
    if (count >= 2) return false;
    perBookmark.set(hit.bookmark_id, count + 1);
    return true;
  }).slice(0, limit);
}

function insertTop(top: SemanticHit[], hit: SemanticHit, capacity: number): void {
  const index = top.findIndex((current) => hit.score > current.score);
  if (index === -1) top.push(hit);
  else top.splice(index, 0, hit);
  if (top.length > capacity) top.length = capacity;
}

function serializeVector(values: number[]): string {
  if (values.length !== GEMINI_EMBEDDING_DIMENSIONS) {
    throw new Error("Unexpected embedding size.");
  }
  return JSON.stringify(values.map((value) => Math.fround(value)));
}

function parseVector(value: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== GEMINI_EMBEDDING_DIMENSIONS) return null;
    const values = parsed.map(Number);
    return values.every((item) => Number.isFinite(item) && Math.abs(item) <= 100)
      ? values
      : null;
  } catch {
    return null;
  }
}

async function updateStateError(error: string | null): Promise<void> {
  await env.DB.prepare(`
    UPDATE semantic_index_state
    SET last_error = ?, updated_at = ?
    WHERE id = ?
  `).bind(error, new Date().toISOString(), STATE_ID).run();
}

function safeSemanticError(error: unknown): string {
  if (error instanceof GeminiFileSearchError) {
    return `${error.message} [${error.code}]`.slice(0, 300);
  }
  return "Semantic indexing failed safely.";
}

function safeStoredError(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  const parsed = Math.floor(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : minimum;
}
