import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    siteName: text("site_name").notNull().default(""),
    author: text("author").notNull().default(""),
    publishedAt: text("published_at"),
    lang: text("lang"),
    contentType: text("content_type"),
    status: text("status").notNull().default("processing"),
    error: text("error"),
    excerpt: text("excerpt").notNull().default(""),
    markdownKey: text("markdown_key"),
    rawKey: text("raw_key"),
    imageUrl: text("image_url"),
    previewImageKey: text("preview_image_key"),
    faviconUrl: text("favicon_url"),
    wordCount: integer("word_count").notNull().default(0),
    fetchMethod: text("fetch_method"),
    searchStatus: text("search_status").notNull().default("pending"),
    searchVersion: integer("search_version").notNull().default(0),
    searchContentHash: text("search_content_hash"),
    searchChunkCount: integer("search_chunk_count").notNull().default(0),
    searchIndexedAt: text("search_indexed_at"),
    searchIndexError: text("search_index_error"),
    searchTruncated: integer("search_truncated").notNull().default(0),
    sourceRevision: text("source_revision"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("bookmarks_canonical_url_unique").on(table.canonicalUrl),
    index("bookmarks_created_at_idx").on(table.createdAt),
    index("bookmarks_status_created_at_idx").on(table.status, table.createdAt),
    index("bookmarks_updated_at_idx").on(table.updatedAt),
  ],
);

export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

export const bookmarkChunks = sqliteTable(
  "bookmark_chunks",
  {
    id: text("id").primaryKey(),
    bookmarkId: text("bookmark_id").notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    revision: text("revision").notNull(),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull().default(""),
    siteName: text("site_name").notNull().default(""),
    author: text("author").notNull().default(""),
    heading: text("heading").notNull().default(""),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("bookmark_chunks_bookmark_revision_ordinal_unique").on(
      table.bookmarkId,
      table.revision,
      table.ordinal,
    ),
    index("bookmark_chunks_active_revision_idx").on(
      table.bookmarkId,
      table.revision,
      table.ordinal,
    ),
  ],
);

export type BookmarkChunk = typeof bookmarkChunks.$inferSelect;
export type NewBookmarkChunk = typeof bookmarkChunks.$inferInsert;

// Portable semantic fallback for Sites projects where the managed File Search
// Store API is unavailable. Vectors are stored as bounded JSON text so the
// Cloudflare Worker never depends on Node's Buffer implementation.
export const semanticEmbeddings = sqliteTable(
  "semantic_embeddings",
  {
    chunkId: text("chunk_id").primaryKey()
      .references(() => bookmarkChunks.id, { onDelete: "cascade" }),
    bookmarkId: text("bookmark_id").notNull(),
    revision: text("revision").notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    vector: text("vector").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("semantic_embeddings_bookmark_revision_idx").on(
      table.bookmarkId,
      table.revision,
    ),
    index("semantic_embeddings_model_dimensions_idx").on(
      table.model,
      table.dimensions,
    ),
  ],
);

export const semanticIndexState = sqliteTable("semantic_index_state", {
  id: text("id").primaryKey(),
  active: integer("active").notNull().default(0),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fileSearchStores = sqliteTable(
  "file_search_stores",
  {
    id: text("id").primaryKey(),
    storeName: text("store_name"),
    displayName: text("display_name").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("file_search_stores_store_name_unique").on(table.storeName),
  ],
);

export type FileSearchStore = typeof fileSearchStores.$inferSelect;

// This table intentionally has no cascading bookmark foreign key. A row is
// retained as a tombstone until any remote File Search document has been
// deleted, even when the local bookmark is already gone.
export const fileSearchDocuments = sqliteTable(
  "file_search_documents",
  {
    bookmarkId: text("bookmark_id").primaryKey(),
    revision: text("revision").notNull(),
    displayName: text("display_name").notNull(),
    storeName: text("store_name"),
    documentName: text("document_name"),
    remoteRevision: text("remote_revision"),
    operationName: text("operation_name"),
    operationRevision: text("operation_revision"),
    status: text("status").notNull().default("pending"),
    indexedAt: text("indexed_at"),
    lastAttemptedAt: text("last_attempted_at"),
    error: text("error"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("file_search_documents_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("file_search_documents_store_document_idx").on(
      table.storeName,
      table.documentName,
    ),
  ],
);

export type FileSearchDocument = typeof fileSearchDocuments.$inferSelect;

export const fileSearchGarbage = sqliteTable(
  "file_search_garbage",
  {
    documentName: text("document_name").primaryKey(),
    storeName: text("store_name").notNull(),
    reason: text("reason").notNull(),
    lastAttemptedAt: text("last_attempted_at"),
    error: text("error"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("file_search_garbage_updated_idx").on(table.updatedAt),
  ],
);

export const captureDevices = sqliteTable(
  "capture_devices",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenHint: text("token_hint").notNull(),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: text("last_used_at"),
    rateWindowStartedAt: text("rate_window_started_at"),
    rateWindowCount: integer("rate_window_count").notNull().default(0),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("capture_devices_token_hash_unique").on(table.tokenHash),
    index("capture_devices_active_created_at_idx").on(
      table.revokedAt,
      table.createdAt,
    ),
  ],
);

export type CaptureDevice = typeof captureDevices.$inferSelect;
export type NewCaptureDevice = typeof captureDevices.$inferInsert;

export const agentClients = sqliteTable(
  "agent_clients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerEmail: text("owner_email").notNull().default(""),
    tokenHash: text("token_hash").notNull(),
    tokenHint: text("token_hint").notNull(),
    scopes: text("scopes").notNull().default('["search","read","recent"]'),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: text("last_used_at"),
    rateWindowStartedAt: text("rate_window_started_at"),
    rateWindowCount: integer("rate_window_count").notNull().default(0),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("agent_clients_token_hash_unique").on(table.tokenHash),
    index("agent_clients_active_created_at_idx").on(
      table.revokedAt,
      table.createdAt,
    ),
  ],
);

export type AgentClient = typeof agentClients.$inferSelect;
export type NewAgentClient = typeof agentClients.$inferInsert;

export const oauthClients = sqliteTable(
  "oauth_clients",
  {
    clientId: text("client_id").primaryKey(),
    clientName: text("client_name").notNull(),
    clientUri: text("client_uri"),
    redirectUris: text("redirect_uris").notNull(),
    grantTypes: text("grant_types").notNull(),
    responseTypes: text("response_types").notNull(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("oauth_clients_active_created_at_idx").on(table.revokedAt, table.createdAt),
  ],
);

export const oauthAuthorizationRequests = sqliteTable(
  "oauth_authorization_requests",
  {
    transactionHash: text("transaction_hash").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    clientId: text("client_id").notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    state: text("state"),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    decision: text("decision"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("oauth_authorization_requests_client_expires_idx").on(
      table.clientId,
      table.expiresAt,
    ),
  ],
);

export const oauthTokenFamilies = sqliteTable(
  "oauth_token_families",
  {
    familyId: text("family_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    clientId: text("client_id").notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("oauth_token_families_client_active_idx").on(
      table.clientId,
      table.revokedAt,
      table.expiresAt,
    ),
  ],
);

export const oauthAuthorizationCodes = sqliteTable(
  "oauth_authorization_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    clientId: text("client_id").notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("oauth_authorization_codes_client_expires_idx").on(
      table.clientId,
      table.expiresAt,
    ),
  ],
);

export const oauthAccessTokens = sqliteTable(
  "oauth_access_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    tokenHint: text("token_hint").notNull(),
    familyId: text("family_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    clientId: text("client_id").notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("oauth_access_tokens_client_active_idx").on(
      table.clientId,
      table.revokedAt,
      table.expiresAt,
    ),
    index("oauth_access_tokens_family_idx").on(table.familyId),
  ],
);

export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    tokenHint: text("token_hint").notNull(),
    familyId: text("family_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    clientId: text("client_id").notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("oauth_refresh_tokens_client_active_idx").on(
      table.clientId,
      table.revokedAt,
      table.expiresAt,
    ),
    index("oauth_refresh_tokens_family_idx").on(table.familyId),
  ],
);

export const oauthRateLimits = sqliteTable(
  "oauth_rate_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    windowStartedAt: text("window_started_at").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("oauth_rate_limits_updated_at_idx").on(table.updatedAt)],
);
