import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "@/db";
import { bookmarks, type Bookmark } from "@/db/schema";
import { extractUrl, fetchPreviewImage, normalizeAndValidateUrl } from "@/lib/extractor";
import { ApiError } from "@/lib/http";
import {
  advanceFileSearchIndex,
  queueFileSearchDeletion,
} from "@/lib/file-search";
import { deleteBookmarkIndex, indexBookmarkContent } from "@/lib/knowledge";
import {
  deleteArtifacts,
  getArchiveText,
  getPreviewImage,
  putArtifacts,
  putPreviewImage,
} from "@/lib/storage";

export type BookmarkWithContent = Bookmark & { content: string };

export async function listBookmarks(input: {
  query?: string;
  status?: string;
  limit?: number;
} = {}): Promise<Bookmark[]> {
  const db = getDb();
  const limit = clampLimit(input.limit, 50, 100);
  const query = input.query?.trim();
  const status = input.status?.trim();
  const search = query ? bookmarkSearchCondition(query) : undefined;
  const condition = search && status
    ? and(search, eq(bookmarks.status, status))
    : search ?? (status ? eq(bookmarks.status, status) : undefined);

  if (condition) {
    return db.select().from(bookmarks)
      .where(condition)
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
      .limit(limit);
  }
  return db.select().from(bookmarks)
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .limit(limit);
}

export async function getBookmark(id: string): Promise<Bookmark | null> {
  const [bookmark] = await getDb().select().from(bookmarks)
    .where(eq(bookmarks.id, id))
    .limit(1);
  return bookmark ?? null;
}

export async function createBookmark(inputUrl: string): Promise<Bookmark> {
  const normalizedUrl = normalizeAndValidateUrl(inputUrl);
  const db = getDb();
  const [existing] = await db.select().from(bookmarks)
    .where(eq(bookmarks.canonicalUrl, normalizedUrl))
    .limit(1);
  if (existing) return existing;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    await db.insert(bookmarks).values({
      id,
      url: normalizedUrl,
      canonicalUrl: normalizedUrl,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    // A simultaneous save of the same normalized URL may win the unique race.
    const [duplicate] = await db.select().from(bookmarks)
      .where(eq(bookmarks.canonicalUrl, normalizedUrl))
      .limit(1);
    if (duplicate) return duplicate;
    throw error;
  }

  return captureBookmark(id, normalizedUrl);
}

export async function retryBookmark(id: string): Promise<Bookmark> {
  const bookmark = await getBookmark(id);
  if (!bookmark) throw new ApiError(404, "Bookmark not found.");
  await getDb().update(bookmarks)
    .set({ status: "processing", error: null, updatedAt: new Date().toISOString() })
    .where(eq(bookmarks.id, id));
  return captureBookmark(id, bookmark.url);
}

export async function removeBookmark(id: string): Promise<void> {
  const bookmark = await getBookmark(id);
  if (!bookmark) return;
  await queueFileSearchDeletion(id).catch(() => undefined);
  await deleteArtifacts([bookmark.markdownKey, bookmark.rawKey, bookmark.previewImageKey]);
  await deleteBookmarkIndex(id);
  await getDb().delete(bookmarks).where(eq(bookmarks.id, id));
  await advanceFileSearchIndex({ limit: 1 }).catch(() => undefined);
}

export async function getBookmarkMarkdown(bookmark: Bookmark): Promise<string | null> {
  if (!bookmark.markdownKey) return null;
  return getArchiveText(bookmark.markdownKey);
}

export async function getBookmarkPreview(bookmark: Bookmark): Promise<R2ObjectBody | null> {
  if (!bookmark.previewImageKey) return null;
  return getPreviewImage(bookmark.id, bookmark.previewImageKey);
}

export async function getAiLibrary(input: {
  query?: string;
  limit?: number;
} = {}): Promise<BookmarkWithContent[]> {
  const db = getDb();
  const query = input.query?.trim();
  const limit = clampLimit(input.limit, 20, 50);
  const available = or(eq(bookmarks.status, "ready"), eq(bookmarks.status, "partial"));
  const condition = query
    ? and(available, bookmarkSearchCondition(query))
    : available;

  const rows = await db.select().from(bookmarks)
    .where(condition)
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .limit(limit);

  return Promise.all(rows.map(async (bookmark) => ({
    ...bookmark,
    content: await getBookmarkMarkdown(bookmark) ?? fallbackMarkdown(bookmark),
  })));
}

async function captureBookmark(id: string, inputUrl: string): Promise<Bookmark> {
  const db = getDb();
  const previous = await getBookmark(id);
  try {
    const extracted = await extractUrl(inputUrl);

    if (extracted.canonicalUrl !== inputUrl) {
      const [duplicate] = await db.select().from(bookmarks)
        .where(eq(bookmarks.canonicalUrl, extracted.canonicalUrl))
        .limit(1);
      if (duplicate && duplicate.id !== id) {
        await deleteArtifacts([
          previous?.markdownKey,
          previous?.rawKey,
          previous?.previewImageKey,
        ]);
        await queueFileSearchDeletion(id).catch(() => undefined);
        await deleteBookmarkIndex(id);
        await db.delete(bookmarks).where(eq(bookmarks.id, id));
        return duplicate;
      }
    }

    const [keys, previewImageKey] = await Promise.all([
      putArtifacts({
        id,
        markdown: extracted.markdown,
        raw: extracted.raw,
        rawExtension: extracted.rawExtension,
        rawContentType: extracted.contentType,
      }),
      extracted.imageUrl
        ? fetchPreviewImage(extracted.imageUrl)
          .then((preview) => putPreviewImage({ id, ...preview }))
          .catch(() => previous?.previewImageKey ?? null)
        : Promise.resolve(null),
    ]);

    try {
      const [updated] = await db.update(bookmarks).set({
        canonicalUrl: extracted.canonicalUrl,
        title: extracted.title,
        description: extracted.description,
        siteName: extracted.siteName,
        author: extracted.author,
        publishedAt: extracted.publishedAt,
        lang: extracted.lang,
        contentType: extracted.contentType,
        status: extracted.status,
        error: null,
        excerpt: extracted.excerpt,
        markdownKey: keys.markdownKey,
        rawKey: keys.rawKey,
        imageUrl: extracted.imageUrl,
        previewImageKey,
        faviconUrl: extracted.faviconUrl,
        wordCount: extracted.wordCount,
        fetchMethod: extracted.fetchMethod,
        updatedAt: new Date().toISOString(),
      }).where(eq(bookmarks.id, id)).returning();
      if (!updated) throw new Error("Bookmark disappeared while it was being captured.");
      if (!extracted.imageUrl && previous?.previewImageKey) {
        await deleteArtifacts([previous.previewImageKey]).catch(() => undefined);
      }
      // Search indexing is additive. A failure must not turn a successfully
      // archived page into a failed capture; the prior active revision remains
      // usable and the index can be rebuilt later from R2.
      const indexed = await indexBookmarkContent(updated, extracted.markdown)
        .then(() => true)
        .catch(() => false);
      if (indexed) {
        await advanceFileSearchIndex({ limit: 1 }).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      const [duplicate] = await db.select().from(bookmarks)
        .where(eq(bookmarks.canonicalUrl, extracted.canonicalUrl))
        .limit(1);
      if (duplicate && duplicate.id !== id) {
        await deleteArtifacts([keys.markdownKey, keys.rawKey, previewImageKey]);
        await queueFileSearchDeletion(id).catch(() => undefined);
        await deleteBookmarkIndex(id);
        await db.delete(bookmarks).where(eq(bookmarks.id, id));
        return duplicate;
      }
      throw error;
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    const [failed] = await db.update(bookmarks).set({
      status: "failed",
      error: message,
      searchStatus: previous?.searchContentHash ? previous.searchStatus : "failed",
      searchIndexError: previous?.searchContentHash
        ? previous.searchIndexError
        : "The page was not captured, so no knowledge index is available.",
      updatedAt: new Date().toISOString(),
    }).where(eq(bookmarks.id, id)).returning();
    if (!failed) throw error;
    return failed;
  }
}

function bookmarkSearchCondition(query: string) {
  const pattern = `%${query.slice(0, 300)}%`;
  return or(
    like(bookmarks.title, pattern),
    like(bookmarks.description, pattern),
    like(bookmarks.excerpt, pattern),
    like(bookmarks.siteName, pattern),
    like(bookmarks.author, pattern),
    like(bookmarks.url, pattern),
    like(bookmarks.canonicalUrl, pattern),
  );
}

function fallbackMarkdown(bookmark: Bookmark): string {
  const title = bookmark.title || bookmark.siteName || bookmark.url;
  const lines = [`# ${title}`, "", `Source: ${bookmark.canonicalUrl || bookmark.url}`];
  if (bookmark.author) lines.push(`Author: ${bookmark.author}`);
  if (bookmark.publishedAt) lines.push(`Published: ${bookmark.publishedAt}`);
  if (bookmark.description) lines.push("", bookmark.description);
  if (bookmark.excerpt && bookmark.excerpt !== bookmark.description) lines.push("", bookmark.excerpt);
  return `${lines.join("\n")}\n`;
}

function safeErrorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : "The page could not be captured.";
  return value.replace(/\s+/g, " ").trim().slice(0, 1_000) || "The page could not be captured.";
}

function clampLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value as number)));
}
