import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  bookmarks,
  fileSearchDocuments,
  fileSearchGarbage,
  fileSearchStores,
  type Bookmark,
  type FileSearchDocument,
} from "@/db/schema";
import {
  createGeminiFileSearchClient,
  GeminiFileSearchError,
  type GeminiGroundingSource,
  type GeminiOperation,
} from "@/lib/gemini-file-search-client";
import { supportedFileSearchRawMime } from "@/lib/file-search-mime";
import {
  advanceLocalSemanticIndex,
  askLocalSemanticLibrary,
  getLocalSemanticIndexStatus,
  type LocalSemanticIndexStatus,
} from "@/lib/local-semantic";
import { getArchiveObject, getArchiveText } from "@/lib/storage";

const PRIMARY_STORE_ID = "primary";
export const STORE_DISPLAY_NAME = "bookmark-site-library";
const STORE_EMBEDDING_MODEL = "models/gemini-embedding-2";
const STORE_CREATION_LEASE = "__file_search_store_creating__";
const STORE_RETRY_DELAY_MS = 60_000;
const MAX_ADVANCE_ITEMS = 8;
const REFUSAL_TEXT = "收藏中找不到足夠資料回答這個問題。";

type GeminiBindings = {
  GEMINI_API_KEY?: string;
  GEMINI_FILE_SEARCH_MODEL?: string;
};

export type FileSearchIndexStatus = {
  configured: boolean;
  backend: "file_search" | "sites_embeddings";
  storeReady: boolean;
  storeCreating: boolean;
  total: number;
  indexed: number;
  pending: number;
  indexing: number;
  failed: number;
  complete: boolean;
  error: string | null;
};

export type FileSearchCitation = {
  citationId: string;
  bookmarkId: string;
  revision: string;
  title: string;
  url: string;
  excerpt: string;
  pageNumber: number | null;
  claims: string[];
};

export type FileSearchLibraryAnswer = {
  answered: boolean;
  answer: string;
  refusalReason:
    | "not_configured"
    | "index_not_ready"
    | "insufficient_evidence"
    | "stale_citation"
    | "temporarily_unavailable"
    | null;
  citations: FileSearchCitation[];
  index: FileSearchIndexStatus;
  warning: string | null;
};

export async function queueFileSearchDocument(input: {
  bookmarkId: string;
  revision: string;
  displayName: string;
}): Promise<void> {
  if (!input.bookmarkId || !input.revision) return;
  const db = getDb();
  const [existing] = await db.select().from(fileSearchDocuments)
    .where(eq(fileSearchDocuments.bookmarkId, input.bookmarkId))
    .limit(1);
  const now = new Date().toISOString();
  const displayName = safeDisplayName(input.displayName, input.bookmarkId);
  if (!existing) {
    await db.insert(fileSearchDocuments).values({
      bookmarkId: input.bookmarkId,
      revision: input.revision,
      displayName,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  if (existing.revision === input.revision && existing.status !== "deleting") {
    if (existing.displayName !== displayName) {
      await db.update(fileSearchDocuments).set({ displayName, updatedAt: now })
        .where(eq(fileSearchDocuments.bookmarkId, input.bookmarkId));
    }
    return;
  }
  await db.update(fileSearchDocuments).set({
    revision: input.revision,
    displayName,
    status: existing.operationName ? "indexing" : "pending",
    error: null,
    updatedAt: now,
  }).where(eq(fileSearchDocuments.bookmarkId, input.bookmarkId));
}

export async function queueFileSearchDeletion(bookmarkId: string): Promise<void> {
  const db = getDb();
  const [existing] = await db.select().from(fileSearchDocuments)
    .where(eq(fileSearchDocuments.bookmarkId, bookmarkId))
    .limit(1);
  if (!existing) return;
  const now = new Date().toISOString();
  if (existing.documentName && existing.storeName) {
    await enqueueGarbage(existing.documentName, existing.storeName, "bookmark_deleted");
  }
  await db.update(fileSearchDocuments).set({
    documentName: null,
    remoteRevision: null,
    status: "deleting",
    error: null,
    updatedAt: now,
  }).where(eq(fileSearchDocuments.bookmarkId, bookmarkId));
  if (!existing.operationName && existing.status !== "uploading") {
    await db.delete(fileSearchDocuments)
      .where(eq(fileSearchDocuments.bookmarkId, bookmarkId));
  }
}

export async function getFileSearchIndexStatus(): Promise<FileSearchIndexStatus> {
  const db = getDb();
  const bindings = env as unknown as GeminiBindings;
  const configured = Boolean(bindings.GEMINI_API_KEY?.trim());
  const local = await getLocalSemanticIndexStatus();
  if (local.active) return localStatus(configured, local);
  const [store] = await db.select().from(fileSearchStores)
    .where(eq(fileSearchStores.id, PRIMARY_STORE_ID))
    .limit(1);
  const rows = await db.select({
    bookmarkId: bookmarks.id,
    sourceRevision: bookmarks.sourceRevision,
    documentRevision: fileSearchDocuments.revision,
    remoteRevision: fileSearchDocuments.remoteRevision,
    documentName: fileSearchDocuments.documentName,
    documentStoreName: fileSearchDocuments.storeName,
    operationName: fileSearchDocuments.operationName,
    documentStatus: fileSearchDocuments.status,
    documentError: fileSearchDocuments.error,
  }).from(bookmarks)
    .leftJoin(fileSearchDocuments, eq(fileSearchDocuments.bookmarkId, bookmarks.id))
    .where(or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")));
  let indexed = 0;
  let indexing = 0;
  let failed = 0;
  const storeCreating = store?.lastError === STORE_CREATION_LEASE;
  let firstError = storeCreating ? null : store?.lastError ?? null;
  for (const row of rows) {
    const current = Boolean(
      row.sourceRevision &&
      row.remoteRevision === row.sourceRevision &&
      row.documentRevision === row.sourceRevision &&
      row.documentName &&
      row.documentStoreName === store?.storeName &&
      row.documentStatus === "ready",
    );
    if (current) indexed += 1;
    else if (
      row.operationName ||
      row.documentStatus === "indexing" ||
      row.documentStatus === "uploading"
    ) indexing += 1;
    else if (row.documentStatus === "failed") {
      failed += 1;
      if (!firstError && row.documentError) firstError = row.documentError;
    }
  }
  const total = rows.length;
  const pending = Math.max(0, total - indexed - indexing - failed);
  return {
    configured,
    backend: "file_search",
    storeReady: Boolean(store?.storeName),
    storeCreating,
    total,
    indexed,
    pending,
    indexing,
    failed,
    complete: total === indexed && (configured || total === 0),
    error: firstError,
  };
}

export async function advanceFileSearchIndex(input: {
  limit?: number;
  preferSitesEmbeddings?: boolean;
} = {}): Promise<FileSearchIndexStatus> {
  const client = configuredClient();
  if (!client) return getFileSearchIndexStatus();
  const limit = clampInteger(input.limit, 3, 1, MAX_ADVANCE_ITEMS);
  if (input.preferSitesEmbeddings) {
    return localStatus(true, await advanceLocalSemanticIndex(client, 1));
  }
  const local = await getLocalSemanticIndexStatus();
  if (local.active) {
    return localStatus(true, await advanceLocalSemanticIndex(client, 1));
  }
  const [remoteState] = await getDb().select({
    storeName: fileSearchStores.storeName,
    lastError: fileSearchStores.lastError,
  }).from(fileSearchStores)
    .where(eq(fileSearchStores.id, PRIMARY_STORE_ID))
    .limit(1);
  if (
    !remoteState?.storeName &&
    remoteState?.lastError &&
    remoteState.lastError !== STORE_CREATION_LEASE
  ) {
    return localStatus(true, await advanceLocalSemanticIndex(client, 1));
  }
  let storeName: string;
  try {
    storeName = await ensureStore(client);
  } catch {
    const local = await advanceLocalSemanticIndex(client, 1);
    return localStatus(true, local);
  }

  const [activeStore] = await getDb().select({
    embeddingModel: fileSearchStores.embeddingModel,
  }).from(fileSearchStores)
    .where(eq(fileSearchStores.id, PRIMARY_STORE_ID))
    .limit(1);
  const supportsMultimodal = activeStore?.embeddingModel === STORE_EMBEDDING_MODEL;

  await queueMissingDocuments(limit);
  const db = getDb();
  const retryBefore = new Date(Date.now() - 60_000).toISOString();
  const abandonedUploadBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const rows = await db.select().from(fileSearchDocuments)
    .where(or(
      eq(fileSearchDocuments.status, "deleting"),
      eq(fileSearchDocuments.status, "indexing"),
      eq(fileSearchDocuments.status, "pending"),
      and(
        eq(fileSearchDocuments.status, "uploading"),
        or(
          isNull(fileSearchDocuments.lastAttemptedAt),
          lt(fileSearchDocuments.lastAttemptedAt, abandonedUploadBefore),
        ),
      ),
      and(
        eq(fileSearchDocuments.status, "failed"),
        or(
          isNull(fileSearchDocuments.lastAttemptedAt),
          lt(fileSearchDocuments.lastAttemptedAt, retryBefore),
        ),
      ),
    ))
    .orderBy(
      asc(fileSearchDocuments.status),
      asc(fileSearchDocuments.updatedAt),
    )
    .limit(limit);
  for (const row of rows) {
    await advanceDocument(client, storeName, row, supportsMultimodal).catch(async (error) => {
      await markDocumentFailure(row.bookmarkId, error);
    });
  }
  await processGarbage(client, limit);
  return getFileSearchIndexStatus();
}

export async function askFileSearchLibrary(
  question: string,
): Promise<FileSearchLibraryAnswer> {
  const client = configuredClient();
  if (!client) {
    return refusal(
      "not_configured",
      "語意問答尚未設定；仍可使用書籤搜尋與原文讀取。",
      await getFileSearchIndexStatus(),
    );
  }
  const index = await getFileSearchIndexStatus();
  if (!index.storeReady || index.indexed === 0) {
    return refusal(
      "index_not_ready",
      "語意索引仍在準備，請稍後再問。",
      index,
    );
  }
  if (index.backend === "sites_embeddings") {
    try {
      const local = await askLocalSemanticLibrary(client, normalizeQuestion(question));
      if (!local) return refusal("insufficient_evidence", REFUSAL_TEXT, index);
      return {
        answered: true,
        answer: local.answer,
        refusalReason: null,
        citations: local.citations,
        index,
        warning: index.complete
          ? null
          : `語意索引尚未涵蓋全部收藏（${index.indexed}/${index.total}）；回答只根據已完成索引的內容。`,
      };
    } catch {
      return refusal(
        "temporarily_unavailable",
        "語意問答暫時無法使用，請改用書籤搜尋或稍後重試。",
        index,
      );
    }
  }
  const [store] = await getDb().select().from(fileSearchStores)
    .where(eq(fileSearchStores.id, PRIMARY_STORE_ID))
    .limit(1);
  if (!store?.storeName) {
    return refusal("index_not_ready", "語意索引仍在準備，請稍後再問。", index);
  }

  try {
    const grounded = await client.ask(normalizeQuestion(question), store.storeName);
    if (!grounded.answer || grounded.answer.includes(REFUSAL_TEXT)) {
      return refusal("insufficient_evidence", REFUSAL_TEXT, index);
    }
    const validated = await validateGrounding(grounded.sources, grounded.supports);
    if (validated.stale || validated.citations.length === 0) {
      return refusal(
        validated.stale ? "stale_citation" : "insufficient_evidence",
        REFUSAL_TEXT,
        index,
      );
    }
    return {
      answered: true,
      answer: grounded.answer,
      refusalReason: null,
      citations: validated.citations,
      index,
      warning: index.complete
        ? null
        : `語意索引尚未涵蓋全部收藏（${index.indexed}/${index.total}）；回答只根據已完成索引的內容。`,
    };
  } catch (error) {
    const reason = error instanceof GeminiFileSearchError && error.code === "not_configured"
      ? "not_configured"
      : "temporarily_unavailable";
    return refusal(
      reason,
      reason === "not_configured"
        ? "語意問答尚未設定；仍可使用書籤搜尋與原文讀取。"
        : "語意問答暫時無法使用，請改用書籤搜尋或稍後重試。",
      index,
    );
  }
}

function localStatus(
  configured: boolean,
  local: LocalSemanticIndexStatus,
): FileSearchIndexStatus {
  return {
    configured,
    backend: "sites_embeddings",
    storeReady: local.storeReady,
    storeCreating: false,
    total: local.total,
    indexed: local.indexed,
    pending: local.pending,
    indexing: local.indexing,
    failed: local.failed,
    complete: configured && local.complete,
    error: local.error,
  };
}

async function queueMissingDocuments(limit: number): Promise<void> {
  const rows = await getDb().select({
    bookmarkId: bookmarks.id,
    sourceRevision: bookmarks.sourceRevision,
    title: bookmarks.title,
    siteName: bookmarks.siteName,
    documentBookmarkId: fileSearchDocuments.bookmarkId,
    documentRevision: fileSearchDocuments.revision,
  }).from(bookmarks)
    .leftJoin(fileSearchDocuments, eq(fileSearchDocuments.bookmarkId, bookmarks.id))
    .where(and(
      or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")),
      or(
        isNull(fileSearchDocuments.bookmarkId),
        ne(fileSearchDocuments.revision, bookmarks.sourceRevision),
      ),
    ))
    .orderBy(asc(bookmarks.updatedAt), asc(bookmarks.id))
    .limit(limit);
  for (const row of rows) {
    if (!row.sourceRevision) continue;
    await queueFileSearchDocument({
      bookmarkId: row.bookmarkId,
      revision: row.sourceRevision,
      displayName: row.title || row.siteName || row.bookmarkId,
    });
  }
}

async function advanceDocument(
  client: NonNullable<ReturnType<typeof configuredClient>>,
  storeName: string,
  initial: FileSearchDocument,
  supportsMultimodal: boolean,
): Promise<void> {
  const db = getDb();
  const [bookmark] = await db.select().from(bookmarks)
    .where(and(
      eq(bookmarks.id, initial.bookmarkId),
      or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")),
    ))
    .limit(1);
  if (!bookmark || initial.status === "deleting") {
    await finishDeletion(client, initial);
    return;
  }
  if (!bookmark.sourceRevision) return;
  if (initial.revision !== bookmark.sourceRevision) {
    await queueFileSearchDocument({
      bookmarkId: bookmark.id,
      revision: bookmark.sourceRevision,
      displayName: bookmark.title || bookmark.siteName || bookmark.id,
    });
  }
  const [row] = await db.select().from(fileSearchDocuments)
    .where(eq(fileSearchDocuments.bookmarkId, bookmark.id))
    .limit(1);
  if (!row) return;
  if (row.status === "deleting") {
    await finishDeletion(client, row);
    return;
  }

  if (row.operationName) {
    const operation = await client.getOperation(row.operationName);
    if (!operation.done) {
      await db.update(fileSearchDocuments).set({
        status: "indexing",
        lastAttemptedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(fileSearchDocuments.bookmarkId, row.bookmarkId),
        eq(fileSearchDocuments.operationName, row.operationName),
        ne(fileSearchDocuments.status, "deleting"),
      ));
      return;
    }
    await completeOperation(client, storeName, row, operation, bookmark);
    return;
  }

  if (
    row.documentName &&
    row.remoteRevision === bookmark.sourceRevision &&
    row.storeName === storeName
  ) {
    if (row.status !== "ready") {
      await db.update(fileSearchDocuments).set({
        status: "ready",
        error: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(fileSearchDocuments.bookmarkId, row.bookmarkId));
    }
    return;
  }

  const claimTime = new Date().toISOString();
  const abandonedUploadBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const [claimed] = await db.update(fileSearchDocuments).set({
    status: "uploading",
    lastAttemptedAt: claimTime,
    error: null,
    updatedAt: claimTime,
  }).where(and(
    eq(fileSearchDocuments.bookmarkId, row.bookmarkId),
    isNull(fileSearchDocuments.operationName),
    or(
      eq(fileSearchDocuments.status, "pending"),
      eq(fileSearchDocuments.status, "failed"),
      and(
        eq(fileSearchDocuments.status, "uploading"),
        or(
          isNull(fileSearchDocuments.lastAttemptedAt),
          lt(fileSearchDocuments.lastAttemptedAt, abandonedUploadBefore),
        ),
      ),
    ),
  )).returning();
  if (!claimed) return;

  const source = await fileSearchSource(bookmark, supportsMultimodal);
  const operation = await client.uploadDocument({
    storeName,
    bytes: source.bytes,
    byteLength: source.byteLength,
    mimeType: source.mimeType,
    displayName: row.displayName,
    metadata: {
      bookmark_id: bookmark.id,
      revision: bookmark.sourceRevision,
      source_url: (bookmark.canonicalUrl || bookmark.url).slice(0, 1_800),
      title: (bookmark.title || bookmark.siteName || bookmark.id).slice(0, 500),
      captured_at: bookmark.createdAt,
    },
  });
  const now = new Date().toISOString();
  const operationState = {
    storeName,
    operationName: operation.name,
    operationRevision: bookmark.sourceRevision,
    lastAttemptedAt: now,
    error: null,
    updatedAt: now,
  };
  const [persisted] = await db.update(fileSearchDocuments).set({
    ...operationState,
    status: "indexing",
  }).where(and(
    eq(fileSearchDocuments.bookmarkId, bookmark.id),
    isNull(fileSearchDocuments.operationName),
    ne(fileSearchDocuments.status, "deleting"),
  )).returning();
  if (!persisted) {
    const [tombstone] = await db.update(fileSearchDocuments).set({
      ...operationState,
      status: "deleting",
    }).where(and(
      eq(fileSearchDocuments.bookmarkId, bookmark.id),
      eq(fileSearchDocuments.status, "deleting"),
      isNull(fileSearchDocuments.operationName),
    )).returning();
    if (tombstone && operation.done) {
      await finishDeletion(client, tombstone);
    } else if (!tombstone && operation.done && operation.documentName) {
      await enqueueGarbage(operation.documentName, storeName, "orphaned_upload");
    }
    return;
  }
  if (operation.done) {
    await completeOperation(client, storeName, persisted, operation, bookmark);
  }
}

async function completeOperation(
  client: NonNullable<ReturnType<typeof configuredClient>>,
  storeName: string,
  row: FileSearchDocument,
  operation: GeminiOperation,
  bookmark: Bookmark,
): Promise<void> {
  const db = getDb();
  if (operation.error) {
    const [failed] = await db.update(fileSearchDocuments).set({
      operationName: null,
      operationRevision: null,
      status: "failed",
      error: safeSyncError(operation.error),
      lastAttemptedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(fileSearchDocuments.bookmarkId, row.bookmarkId),
      eq(fileSearchDocuments.operationName, operation.name),
      ne(fileSearchDocuments.status, "deleting"),
    )).returning({ bookmarkId: fileSearchDocuments.bookmarkId });
    if (!failed) {
      await db.delete(fileSearchDocuments).where(and(
        eq(fileSearchDocuments.bookmarkId, row.bookmarkId),
        eq(fileSearchDocuments.status, "deleting"),
      ));
    }
    return;
  }
  if (!operation.documentName) {
    throw new Error("File Search indexing completed without a document name.");
  }
  const operationRevision = row.operationRevision ?? "";
  if (operationRevision !== bookmark.sourceRevision) {
    await enqueueGarbage(operation.documentName, storeName, "stale_operation");
    const [reset] = await db.update(fileSearchDocuments).set({
      operationName: null,
      operationRevision: null,
      status: "pending",
      error: null,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(fileSearchDocuments.bookmarkId, row.bookmarkId),
      eq(fileSearchDocuments.operationName, operation.name),
      ne(fileSearchDocuments.status, "deleting"),
    )).returning({ bookmarkId: fileSearchDocuments.bookmarkId });
    if (!reset) {
      await db.delete(fileSearchDocuments).where(and(
        eq(fileSearchDocuments.bookmarkId, row.bookmarkId),
        eq(fileSearchDocuments.status, "deleting"),
      ));
    }
    return;
  }
  if (row.documentName && row.documentName !== operation.documentName && row.storeName) {
    await enqueueGarbage(row.documentName, row.storeName, "superseded_revision");
  }
  const now = new Date().toISOString();
  const [activated] = await db.update(fileSearchDocuments).set({
    revision: bookmark.sourceRevision,
    storeName,
    documentName: operation.documentName,
    remoteRevision: bookmark.sourceRevision,
    operationName: null,
    operationRevision: null,
    status: "ready",
    indexedAt: now,
    lastAttemptedAt: now,
    error: null,
    updatedAt: now,
  }).where(and(
    eq(fileSearchDocuments.bookmarkId, row.bookmarkId),
    eq(fileSearchDocuments.operationName, operation.name),
    ne(fileSearchDocuments.status, "deleting"),
  )).returning({ bookmarkId: fileSearchDocuments.bookmarkId });
  if (!activated) {
    await enqueueGarbage(operation.documentName, storeName, "deleted_during_indexing");
    await db.delete(fileSearchDocuments).where(and(
      eq(fileSearchDocuments.bookmarkId, row.bookmarkId),
      eq(fileSearchDocuments.status, "deleting"),
    ));
  }
  await processGarbage(client, 1);
}

async function finishDeletion(
  client: NonNullable<ReturnType<typeof configuredClient>>,
  row: FileSearchDocument,
): Promise<void> {
  const db = getDb();
  if (row.documentName && row.storeName) {
    await enqueueGarbage(row.documentName, row.storeName, "bookmark_deleted");
  }
  if (row.operationName) {
    const operation = await client.getOperation(row.operationName);
    if (!operation.done) return;
    if (operation.documentName) {
      await enqueueGarbage(
        operation.documentName,
        row.storeName || PRIMARY_STORE_ID,
        "deleted_during_indexing",
      );
    }
  }
  await db.delete(fileSearchDocuments)
    .where(eq(fileSearchDocuments.bookmarkId, row.bookmarkId));
}

async function ensureStore(
  client: NonNullable<ReturnType<typeof configuredClient>>,
): Promise<string> {
  const db = getDb();
  const [existing] = await db.select().from(fileSearchStores)
    .where(eq(fileSearchStores.id, PRIMARY_STORE_ID))
    .limit(1);
  if (existing?.storeName) return existing.storeName;
  const now = new Date().toISOString();
  let claimed = false;
  if (existing) {
    const lastUpdated = Date.parse(existing.updatedAt);
    const retryBlocked = Boolean(existing.lastError) &&
      Number.isFinite(lastUpdated) &&
      Date.now() - lastUpdated < STORE_RETRY_DELAY_MS;
    if (!retryBlocked) {
      const [row] = await db.update(fileSearchStores).set({
        lastError: STORE_CREATION_LEASE,
        updatedAt: now,
      }).where(and(
        eq(fileSearchStores.id, PRIMARY_STORE_ID),
        isNull(fileSearchStores.storeName),
        eq(fileSearchStores.updatedAt, existing.updatedAt),
      )).returning({ id: fileSearchStores.id });
      claimed = Boolean(row);
    }
  } else {
    const [row] = await db.insert(fileSearchStores).values({
      id: PRIMARY_STORE_ID,
      displayName: STORE_DISPLAY_NAME,
      embeddingModel: STORE_EMBEDDING_MODEL,
      lastError: STORE_CREATION_LEASE,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning({ id: fileSearchStores.id });
    claimed = Boolean(row);
  }
  if (!claimed) {
    throw new GeminiFileSearchError(
      "temporarily_unavailable",
      "Gemini File Search setup is waiting for a safe retry.",
    );
  }
  try {
    let created: Awaited<ReturnType<typeof client.createStore>>;
    try {
      created = await client.createStore(STORE_DISPLAY_NAME);
    } catch (error) {
      if (!canRetryStoreCreation(error)) throw error;
      try {
        // The official File Search REST examples use ?key= for store creation.
        // Keep header auth first, then retry that exact server-to-Google form.
        created = await client.createStore(
          STORE_DISPLAY_NAME,
          STORE_EMBEDDING_MODEL,
          "query",
        );
      } catch (fallbackError) {
        if (!canRetryStoreCreation(fallbackError)) throw fallbackError;
        try {
          created = await client.createStore(STORE_DISPLAY_NAME, null, "query");
        } catch (defaultModelError) {
          if (!canRetryStoreCreation(defaultModelError)) throw defaultModelError;
          created = await client.createStore(null, null, "query");
        }
      }
    }
    const [activated] = await db.update(fileSearchStores).set({
      storeName: created.name,
      displayName: created.displayName || STORE_DISPLAY_NAME,
      embeddingModel: created.embeddingModel || STORE_EMBEDDING_MODEL,
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(fileSearchStores.id, PRIMARY_STORE_ID),
      isNull(fileSearchStores.storeName),
      eq(fileSearchStores.lastError, STORE_CREATION_LEASE),
      eq(fileSearchStores.updatedAt, now),
    )).returning({ id: fileSearchStores.id });
    if (!activated) {
      await client.deleteStore(created.name);
      throw new GeminiFileSearchError(
        "temporarily_unavailable",
        "Gemini File Search setup changed while the store was being created.",
      );
    }
    return created.name;
  } catch (error) {
    const message = safeSyncError(error);
    await db.update(fileSearchStores).set({
      lastError: message,
      updatedAt: now,
    }).where(and(
      eq(fileSearchStores.id, PRIMARY_STORE_ID),
      isNull(fileSearchStores.storeName),
      eq(fileSearchStores.lastError, STORE_CREATION_LEASE),
      eq(fileSearchStores.updatedAt, now),
    ));
    throw error;
  }
}

function canRetryStoreCreation(error: unknown): boolean {
  return error instanceof GeminiFileSearchError &&
    error.code === "request_rejected" &&
    error.status === 400;
}

async function fileSearchSource(bookmark: Bookmark, supportsMultimodal: boolean): Promise<{
  bytes: ArrayBuffer | ReadableStream<Uint8Array>;
  byteLength: number;
  mimeType: string;
}> {
  const rawMime = (bookmark.contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (bookmark.rawKey && supportedFileSearchRawMime(rawMime, supportsMultimodal)) {
    const raw = await getArchiveObject(bookmark.rawKey);
    if (raw && raw.size > 0 && raw.size <= 100 * 1024 * 1024) {
      return {
        bytes: raw.body,
        byteLength: raw.size,
        mimeType: rawMime,
      };
    }
  }
  const markdown = bookmark.markdownKey
    ? await getArchiveText(bookmark.markdownKey)
    : null;
  const fallback = [
    `# ${bookmark.title || bookmark.siteName || bookmark.url}`,
    `Source: ${bookmark.canonicalUrl || bookmark.url}`,
    bookmark.author ? `Author: ${bookmark.author}` : "",
    bookmark.description,
    bookmark.excerpt,
  ].filter(Boolean).join("\n\n");
  const bytes = new TextEncoder().encode(markdown?.trim() || fallback).buffer;
  return {
    bytes,
    byteLength: bytes.byteLength,
    mimeType: "text/markdown",
  };
}

async function validateGrounding(
  sources: GeminiGroundingSource[],
  supports: Array<{ claim: string; sources: GeminiGroundingSource[] }>,
): Promise<{ stale: boolean; citations: FileSearchCitation[] }> {
  const referenced = supports.flatMap((support) => support.sources);
  const allSources = referenced.length ? referenced : sources;
  const ids = [...new Set(allSources.map((source) => source.metadata.bookmark_id).filter(Boolean))];
  if (!ids.length || !supports.length) return { stale: false, citations: [] };
  const rows = await getDb().select().from(bookmarks).where(and(
    inArray(bookmarks.id, ids),
    or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial")),
  ));
  const local = new Map(rows.map((bookmark) => [bookmark.id, bookmark]));
  const citations = new Map<string, FileSearchCitation>();
  let stale = false;

  for (const support of supports) {
    if (!support.claim.trim() || !support.sources.length) {
      stale = true;
      continue;
    }
    for (const source of support.sources) {
      const bookmarkId = source.metadata.bookmark_id ?? "";
      const revision = source.metadata.revision ?? "";
      const bookmark = local.get(bookmarkId);
      if (!bookmark || !revision || bookmark.sourceRevision !== revision) {
        stale = true;
        continue;
      }
      const key = `${bookmarkId}:${revision}`;
      const existing = citations.get(key);
      if (existing) {
        if (!existing.claims.includes(support.claim)) existing.claims.push(support.claim);
        continue;
      }
      citations.set(key, {
        citationId: `S${citations.size + 1}`,
        bookmarkId,
        revision,
        title: bookmark.title || bookmark.siteName || bookmark.url,
        url: bookmark.canonicalUrl || bookmark.url,
        excerpt: source.text.slice(0, 1_200),
        pageNumber: source.pageNumber,
        claims: [support.claim],
      });
    }
  }
  return { stale, citations: [...citations.values()] };
}

async function enqueueGarbage(
  documentName: string,
  storeName: string,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  await getDb().insert(fileSearchGarbage).values({
    documentName,
    storeName,
    reason,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: fileSearchGarbage.documentName,
    set: { reason, error: null, updatedAt: now },
  });
}

async function processGarbage(
  client: NonNullable<ReturnType<typeof configuredClient>>,
  limit: number,
): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(fileSearchGarbage)
    .orderBy(asc(fileSearchGarbage.updatedAt))
    .limit(Math.max(1, Math.min(limit, MAX_ADVANCE_ITEMS)));
  for (const row of rows) {
    try {
      await client.deleteDocument(row.documentName);
      await db.delete(fileSearchGarbage)
        .where(eq(fileSearchGarbage.documentName, row.documentName));
    } catch (error) {
      const now = new Date().toISOString();
      await db.update(fileSearchGarbage).set({
        lastAttemptedAt: now,
        error: safeSyncError(error),
        updatedAt: now,
      }).where(eq(fileSearchGarbage.documentName, row.documentName));
    }
  }
}

async function markDocumentFailure(bookmarkId: string, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  await getDb().update(fileSearchDocuments).set({
    status: "failed",
    lastAttemptedAt: now,
    error: safeSyncError(error),
    updatedAt: now,
  }).where(and(
    eq(fileSearchDocuments.bookmarkId, bookmarkId),
    ne(fileSearchDocuments.status, "deleting"),
  ));
}

function configuredClient() {
  const bindings = env as unknown as GeminiBindings;
  const apiKey = bindings.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey) return null;
  return createGeminiFileSearchClient({
    apiKey,
    generationModel: bindings.GEMINI_FILE_SEARCH_MODEL,
  });
}

function refusal(
  reason: Exclude<FileSearchLibraryAnswer["refusalReason"], null>,
  answer: string,
  index: FileSearchIndexStatus,
): FileSearchLibraryAnswer {
  return {
    answered: false,
    answer,
    refusalReason: reason,
    citations: [],
    index,
    warning: null,
  };
}

function normalizeQuestion(value: string): string {
  const question = value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  if (!question) throw new GeminiFileSearchError("invalid_question", "A library question is required.");
  if ([...question].length > 1_000) {
    throw new GeminiFileSearchError("invalid_question", "The library question is too long.");
  }
  return question;
}

function safeDisplayName(value: string, fallback: string): string {
  return (value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim() || fallback).slice(0, 240);
}

function safeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : "File Search synchronization failed.";
  return message.replace(/\s+/g, " ").trim().slice(0, 240) || "File Search synchronization failed.";
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
