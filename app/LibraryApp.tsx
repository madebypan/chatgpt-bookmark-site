"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiConnectionSetup } from "./AiConnectionSetup";
import { ShortcutSetup } from "./ShortcutSetup";

type BookmarkStatus = "processing" | "ready" | "partial" | "failed";

type Bookmark = {
  id: string;
  url: string;
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  publishedAt: string | null;
  lang: string | null;
  contentType: string | null;
  status: BookmarkStatus;
  error: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  previewImageKey: string | null;
  faviconUrl: string | null;
  wordCount: number | null;
  fetchMethod: string | null;
  createdAt: string;
  updatedAt: string;
};

type Filter = "all" | "ready" | "attention";

const statusCopy: Record<BookmarkStatus, { label: string; tone: string }> = {
  processing: { label: "擷取中", tone: "processing" },
  ready: { label: "已完成", tone: "ready" },
  partial: { label: "部分完成", tone: "partial" },
  failed: { label: "需要處理", tone: "failed" },
};

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function displayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "剛剛";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("zh-TW", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(date);
}

function displayFullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return friendlyError(body.error || "", fallback);
  } catch {
    return fallback;
  }
}

function friendlyError(message: string, fallback = "暫時無法處理這個網址") {
  if (!message) return fallback;
  if (/signed-in|write access|capture_token/i.test(message)) return "請先登入這個私人 Site，再儲存網址。";
  if (/valid|a url is required|non-empty|http and https|username or password/i.test(message)) return "請貼上可公開開啟的 http 或 https 網址。";
  if (/private|local network|special-use|single-label|ipv6|wildcard-dns/i.test(message)) return "基於安全考量，不能擷取內部網路或本機網址。";
  if (/within \d+ seconds|did not respond|did not finish|timeout/i.test(message)) return "網站回應太久，請稍後再試。";
  if (/http 401|http 403|requires login|forbidden/i.test(message)) return "這個頁面需要登入，或網站拒絕讀取內容。";
  if (/larger than|capture limit/i.test(message)) return "這個頁面太大，目前無法完整保存。";
  if (/unable to fetch|network request failed|could not be fetched/i.test(message)) return "暫時連不到這個網站，網址已保留，可以稍後重試。";
  if (/markdown is not available|bookmark not found/i.test(message)) return "這筆收藏目前沒有可複製的內容。";
  if (/database|archive storage|binding|no such table/i.test(message)) return "資料空間正在準備中，請稍後再試。";
  return fallback;
}

function BookmarkThumbnail({ bookmark }: { bookmark: Bookmark }) {
  const [cachedPreviewFailed, setCachedPreviewFailed] = useState(false);
  const [originPreviewFailed, setOriginPreviewFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const cachedPreview = bookmark.previewImageKey && !cachedPreviewFailed
    ? `/api/bookmarks/${bookmark.id}/preview?v=${encodeURIComponent(bookmark.updatedAt)}`
    : null;
  const originPreview = bookmark.imageUrl && !originPreviewFailed ? bookmark.imageUrl : null;
  const previewSource = cachedPreview || originPreview;

  if (previewSource) {
    return (
      <span className="bookmark-thumbnail has-preview" aria-hidden="true">
        {/* Dynamic previews deliberately bypass the image optimizer and remain behind the private Site gate. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="bookmark-thumbnail-image"
          src={previewSource}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (cachedPreview) setCachedPreviewFailed(true);
            else setOriginPreviewFailed(true);
          }}
        />
      </span>
    );
  }

  if (bookmark.faviconUrl && !faviconFailed) {
    return (
      <span className="bookmark-thumbnail has-favicon" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="bookmark-favicon"
          src={bookmark.faviconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFaviconFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className="bookmark-thumbnail" aria-hidden="true">
      {hostname(bookmark.url).charAt(0).toUpperCase()}
    </span>
  );
}

function BookmarkDetailArtwork({ bookmark }: { bookmark: Bookmark }) {
  const [cachedPreviewFailed, setCachedPreviewFailed] = useState(false);
  const [originPreviewFailed, setOriginPreviewFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const cachedPreview = bookmark.previewImageKey && !cachedPreviewFailed
    ? `/api/bookmarks/${bookmark.id}/preview?v=${encodeURIComponent(bookmark.updatedAt)}`
    : null;
  const originPreview = bookmark.imageUrl && !originPreviewFailed ? bookmark.imageUrl : null;
  const previewSource = cachedPreview || originPreview;

  if (previewSource) {
    return (
      <div className="bookmark-detail-artwork has-preview" aria-hidden="true">
        {/* Dynamic previews deliberately bypass the image optimizer and remain behind the private Site gate. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewSource}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (cachedPreview) setCachedPreviewFailed(true);
            else setOriginPreviewFailed(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="bookmark-detail-artwork is-fallback" aria-hidden="true">
      {bookmark.faviconUrl && !faviconFailed ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={bookmark.faviconUrl}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFaviconFailed(true)}
        />
      ) : (
        <span>{hostname(bookmark.url).charAt(0).toUpperCase()}</span>
      )}
      <strong>{bookmark.siteName || hostname(bookmark.url)}</strong>
    </div>
  );
}

function renderInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(!?\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    if (match[1].startsWith("![")) {
      if (match[2]) nodes.push(match[2]);
    } else if (match[3]) {
      nodes.push(
        <a key={`${keyPrefix}-link-${match.index}`} href={match[3]} target="_blank" rel="noreferrer">
          {match[2] || match[3]}
        </a>,
      );
    } else if (match[4]) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`}>{match[4]}</code>);
    } else if (match[5]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{match[5]}</strong>);
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function MarkdownReader({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: "ordered" | "unordered" | null = null;
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const value = paragraph.join(" ").trim();
    if (value) blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInlineMarkdown(value, `paragraph-${blocks.length}`)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length || !listType) return;
    const items = listItems.map((item, index) => (
      <li key={`${listType}-${blocks.length}-${index}`}>{renderInlineMarkdown(item, `${listType}-${blocks.length}-${index}`)}</li>
    ));
    blocks.push(listType === "ordered"
      ? <ol key={`ordered-${blocks.length}`}>{items}</ol>
      : <ul key={`unordered-${blocks.length}`}>{items}</ul>);
    listItems = [];
    listType = null;
  };

  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (codeLines) {
      if (/^\s*```/.test(line)) {
        blocks.push(<pre key={`code-${blocks.length}`}><code>{codeLines.join("\n")}</code></pre>);
        codeLines = null;
      } else {
        codeLines.push(rawLine);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) continue;

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const content = renderInlineMarkdown(heading[2], `heading-${blocks.length}`);
      blocks.push(heading[1].length <= 2
        ? <h3 key={`heading-${blocks.length}`}>{content}</h3>
        : <h4 key={`heading-${blocks.length}`}>{content}</h4>);
      continue;
    }

    const unordered = /^\s*[-+*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = ordered ? "ordered" : "unordered";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((ordered || unordered)![1]);
      continue;
    }

    const quote = /^\s*>\s?(.+)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInlineMarkdown(quote[1], `quote-${blocks.length}`)}</blockquote>);
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`rule-${blocks.length}`} />);
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  if (codeLines?.length) blocks.push(<pre key={`code-${blocks.length}`}><code>{codeLines.join("\n")}</code></pre>);

  return <div className="bookmark-markdown">{blocks}</div>;
}

export function LibraryApp() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [detailMarkdown, setDetailMarkdown] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [aiConnectionOpen, setAiConnectionOpen] = useState(false);
  const savingRef = useRef(false);
  const shareCaptureHandledRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailCacheRef = useRef(new Map<string, string>());
  const detailRequestRef = useRef<AbortController | null>(null);

  const loadBookmarks = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/bookmarks", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "無法讀取收藏"));
      const body = (await response.json()) as { bookmarks: Bookmark[] };
      setBookmarks(body.bookmarks ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法讀取收藏");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBookmarks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBookmarks]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const saveUrl = useCallback(async (value: string) => {
    const nextUrl = normalizeUrl(value);
    if (!nextUrl || savingRef.current) return;

    savingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: nextUrl }),
      });
      if (!response.ok) throw new Error(await readError(response, "無法儲存這個網址"));
      const body = (await response.json()) as { bookmark: Bookmark };
      setBookmarks((current) => [body.bookmark, ...current.filter((item) => item.id !== body.bookmark.id)]);
      setUrl("");
      if (body.bookmark.status === "failed") {
        setNotice("網址已收下，但擷取需要重試");
      } else {
        setNotice("已收進中轉站");
      }
    } catch (reason) {
      setUrl(value);
      setError(reason instanceof Error ? reason.message : "無法儲存這個網址");
    } finally {
      savingRef.current = false;
      setSubmitting(false);
    }
  }, []);

  useEffect(() => {
    if (shareCaptureHandledRef.current) return;
    shareCaptureHandledRef.current = true;

    const currentUrl = new URL(window.location.href);
    const sharedValue = currentUrl.searchParams.get("url");
    if (sharedValue === null) return;

    currentUrl.searchParams.delete("url");
    const cleanPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}` || "/";
    window.history.replaceState(window.history.state, "", cleanPath);

    const sharedUrl = sharedValue.trim();
    const timer = window.setTimeout(() => {
      if (!sharedUrl) {
        setError("分享內容裡沒有可收錄的網址。");
        return;
      }
      setUrl(sharedUrl);
      setNotice("分享網址已帶入，按「收進來」確認");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-TW");
    return bookmarks.filter((bookmark) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "ready" && bookmark.status === "ready") ||
        (filter === "attention" && ["failed", "partial"].includes(bookmark.status));
      if (!matchesFilter) return false;
      if (!needle) return true;
      return [bookmark.title, bookmark.description, bookmark.excerpt, bookmark.siteName, bookmark.url]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("zh-TW").includes(needle));
    });
  }, [bookmarks, filter, query]);

  const selectedBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === selectedBookmarkId) ?? null,
    [bookmarks, selectedBookmarkId],
  );
  const activeBookmarkId = selectedBookmark?.id ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!activeBookmarkId) {
      if (dialog.open) dialog.close();
      return;
    }

    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-dialog-title]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeBookmarkId]);

  useEffect(() => {
    if (!activeBookmarkId) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [activeBookmarkId]);

  function loadBookmarkDetail(bookmark: Bookmark) {
    detailRequestRef.current?.abort();
    detailRequestRef.current = null;
    if (bookmark.status === "processing") {
      setDetailMarkdown("");
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const cacheKey = `${bookmark.id}:${bookmark.updatedAt}`;
    const cached = detailCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setDetailMarkdown(cached);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    detailRequestRef.current = controller;
    setDetailMarkdown("");
    setDetailError(null);
    setDetailLoading(true);
    void fetch(`/api/bookmarks/${bookmark.id}/markdown`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, "無法讀取正文"));
        return response.text();
      })
      .then((markdown) => {
        detailCacheRef.current.set(cacheKey, markdown);
        setDetailMarkdown(markdown);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setDetailError(reason instanceof Error ? reason.message : "無法讀取正文");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
          if (detailRequestRef.current === controller) detailRequestRef.current = null;
        }
      });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveUrl(url);
  }

  async function retry(id: string) {
    setRetryingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/bookmarks/${id}/retry`, { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "重試失敗"));
      const body = (await response.json()) as { bookmark: Bookmark };
      setBookmarks((current) => current.map((item) => item.id === id ? body.bookmark : item));
      if (selectedBookmarkId === id) loadBookmarkDetail(body.bookmark);
      setNotice(body.bookmark.status === "ready" ? "擷取完成" : "已重新嘗試擷取");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重試失敗");
    } finally {
      setRetryingId(null);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const response = await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response, "刪除失敗"));
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== id));
      setConfirmDeleteId(null);
      if (selectedBookmarkId === id) setSelectedBookmarkId(null);
      setNotice("已刪除");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刪除失敗");
    }
  }

  async function copyMarkdown(bookmark: Bookmark) {
    try {
      const response = await fetch(`/api/bookmarks/${bookmark.id}/markdown`);
      if (!response.ok) throw new Error(await readError(response, "無法取得 Markdown"));
      await navigator.clipboard.writeText(await response.text());
      setNotice("Markdown 已複製");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法複製 Markdown");
    }
  }

  async function copyJson(bookmark: Bookmark) {
    try {
      const response = await fetch(`/api/bookmarks/${bookmark.id}/markdown`);
      const markdown = response.ok ? await response.text() : "";
      const payload = {
        title: bookmark.title,
        source_url: bookmark.canonicalUrl || bookmark.url,
        captured_at: bookmark.createdAt,
        description: bookmark.description,
        author: bookmark.author,
        language: bookmark.lang,
        content: markdown,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setNotice("AI 用 JSON 已複製");
    } catch {
      setError("無法複製 JSON");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="wordmark" aria-label="中轉站">
          <span className="wordmark-mark" aria-hidden="true">↘</span>
          <span>中轉站</span>
        </div>
        <div className="topbar-actions">
          <button
            className={aiConnectionOpen ? "quiet-button selected" : "quiet-button"}
            type="button"
            aria-expanded={aiConnectionOpen}
            onClick={() => {
              setAiConnectionOpen((current) => !current);
              setShortcutOpen(false);
            }}
          >
            連接 AI
          </button>
          <button
            className={shortcutOpen ? "quiet-button selected" : "quiet-button"}
            type="button"
            aria-expanded={shortcutOpen}
            onClick={() => {
              setShortcutOpen((current) => !current);
              setAiConnectionOpen(false);
            }}
          >
            靜默收藏
          </button>
        </div>
      </header>

      {aiConnectionOpen && (
        <AiConnectionSetup onClose={() => setAiConnectionOpen(false)} onNotice={setNotice} />
      )}

      {shortcutOpen && (
        <ShortcutSetup onClose={() => setShortcutOpen(false)} onNotice={setNotice} />
      )}

      <section className="capture" aria-label="新增收藏">
        <form className="capture-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="url-input">貼上網址</label>
          <input
            id="url-input"
            inputMode="url"
            type="text"
            autoFocus
            autoComplete="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="貼上文章、文件或任何網址"
            disabled={submitting}
          />
          <button className="primary-button" type="submit" disabled={submitting || !url.trim()}>
            {submitting ? "正在擷取…" : "收進來"}
          </button>
        </form>
      </section>

      <section className="library" aria-labelledby="library-title">
        <div className="library-heading">
          <div>
            <h2 id="library-title">所有收藏</h2>
            <p>{bookmarks.length ? `${bookmarks.length} 筆收藏` : "你的私人資訊收件匣"}</p>
          </div>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">搜尋收藏</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋標題、來源或描述"
            />
          </label>
        </div>

        <div className="filter-row" aria-label="收藏篩選">
          {([
            ["all", "全部"],
            ["ready", "已完成"],
            ["attention", "待處理"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "filter-chip selected" : "filter-chip"}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
          <button className="refresh-button" type="button" onClick={() => { setLoading(true); void loadBookmarks(); }}>
            重新整理
          </button>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>關閉</button>
          </div>
        )}

        {loading ? (
          <div className="loading-list" aria-label="正在載入收藏">
            {[0, 1, 2].map((item) => <div className="loading-row" key={item} />)}
          </div>
        ) : filtered.length ? (
          <div className="bookmark-list">
            {filtered.map((bookmark) => {
              const status = statusCopy[bookmark.status] ?? statusCopy.partial;
              const title = bookmark.title || hostname(bookmark.url);
              return (
                <article className="bookmark-row" key={bookmark.id}>
                  <button
                    className="bookmark-summary"
                    type="button"
                    aria-haspopup="dialog"
                    aria-controls="bookmark-detail-dialog"
                    onClick={(event) => {
                      detailTriggerRef.current = event.currentTarget;
                      setConfirmDeleteId(null);
                      setSelectedBookmarkId(bookmark.id);
                      loadBookmarkDetail(bookmark);
                    }}
                  >
                    <BookmarkThumbnail key={`${bookmark.id}:${bookmark.updatedAt}`} bookmark={bookmark} />
                    <span className="bookmark-copy">
                      <span className="bookmark-meta">
                        <span>{bookmark.siteName || hostname(bookmark.url)}</span>
                        <span className={`status ${status.tone}`}><i />{status.label}</span>
                        <time dateTime={bookmark.createdAt}>{displayDate(bookmark.createdAt)}</time>
                      </span>
                      <strong>{title}</strong>
                      <span className="bookmark-excerpt">
                        {bookmark.description || bookmark.excerpt || (bookmark.status === "processing"
                          ? "正在整理標題與正文…"
                          : bookmark.status === "failed"
                            ? "網址已保存，等待重新擷取內容。"
                            : "目前只保存到基本資訊。")}
                      </span>
                    </span>
                    <span className="expand-mark" aria-hidden="true">›</span>
                  </button>
                </article>
              );
            })}
          </div>
        ) : bookmarks.length ? (
          <div className="empty-state">
            <strong>沒有符合的收藏</strong>
            <p>換個關鍵字，或切回「全部」看看。</p>
            <button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>清除篩選</button>
          </div>
        ) : (
          <div className="empty-state first-run">
            <span className="empty-arrow" aria-hidden="true">↖</span>
            <strong>從第一個網址開始</strong>
            <p>貼上之後，中轉站會保存來源、描述與乾淨正文，之後可以直接複製給 AI。</p>
          </div>
        )}
      </section>

      <footer>
        <span>內容由你的 Site 保存</span>
        <a href="/api/ai/library" target="_blank" rel="noreferrer">JSON 介面 ↗</a>
      </footer>

      {!selectedBookmark && (
        <div className={notice ? "toast show" : "toast"} role="status" aria-live="polite">
          {notice}
        </div>
      )}

      <dialog
        ref={dialogRef}
        id="bookmark-detail-dialog"
        className="bookmark-dialog"
        aria-labelledby="bookmark-dialog-title"
        onCancel={(event) => {
          if (confirmDeleteId) {
            event.preventDefault();
            setConfirmDeleteId(null);
          }
        }}
        onClose={() => {
          detailRequestRef.current?.abort();
          detailRequestRef.current = null;
          setSelectedBookmarkId(null);
          setConfirmDeleteId(null);
          const trigger = detailTriggerRef.current;
          if (trigger?.isConnected) window.requestAnimationFrame(() => trigger.focus());
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        {selectedBookmark && (() => {
          const status = statusCopy[selectedBookmark.status] ?? statusCopy.partial;
          const title = selectedBookmark.title || hostname(selectedBookmark.url);
          return (
            <div className="bookmark-dialog-frame">
              <header className="bookmark-dialog-topbar">
                <span>{selectedBookmark.siteName || hostname(selectedBookmark.url)}</span>
                <button type="button" aria-label="關閉收藏詳情" onClick={() => dialogRef.current?.close()}>×</button>
              </header>
              <div className="bookmark-dialog-layout">
                <article className="bookmark-dialog-content">
                  <BookmarkDetailArtwork key={`${selectedBookmark.id}:${selectedBookmark.updatedAt}`} bookmark={selectedBookmark} />
                  <div className="bookmark-detail-intro">
                    <div className="bookmark-detail-eyebrow">
                      <span>{selectedBookmark.siteName || hostname(selectedBookmark.url)}</span>
                      <span className={`status ${status.tone}`}><i />{status.label}</span>
                    </div>
                    <h2 id="bookmark-dialog-title" data-dialog-title tabIndex={-1}>{title}</h2>
                    {(selectedBookmark.description || selectedBookmark.excerpt) && (
                      <p>{selectedBookmark.description || selectedBookmark.excerpt}</p>
                    )}
                  </div>
                  <section className="bookmark-article-body" aria-label="收藏正文">
                    {detailLoading ? (
                      <div className="detail-loading" aria-label="正在讀取正文">
                        <span /><span /><span /><span />
                      </div>
                    ) : detailMarkdown ? (
                      <MarkdownReader markdown={detailMarkdown} />
                    ) : selectedBookmark.status === "processing" ? (
                      <div className="detail-empty">
                        <strong>正文仍在整理中</strong>
                        <p>稍後重新整理收藏，就能在這裡閱讀完整內容。</p>
                      </div>
                    ) : (
                      <div className="detail-empty">
                        <strong>目前沒有可顯示的正文</strong>
                        <p>{detailError || "來源與基本資訊已保存，仍可從右側開啟原始頁面。"}</p>
                      </div>
                    )}
                  </section>
                </article>

                <aside className="bookmark-properties" aria-label="收藏資訊">
                  <div>
                    <h3>資訊</h3>
                    <dl className="property-list">
                      <div>
                        <dt>來源</dt>
                        <dd><a href={selectedBookmark.url} target="_blank" rel="noreferrer">{hostname(selectedBookmark.url)} ↗</a></dd>
                      </div>
                      <div>
                        <dt>狀態</dt>
                        <dd><span className={`status ${status.tone}`}><i />{status.label}</span></dd>
                      </div>
                      {selectedBookmark.author && <div><dt>作者</dt><dd>{selectedBookmark.author}</dd></div>}
                      {selectedBookmark.publishedAt && <div><dt>發布時間</dt><dd>{displayFullDate(selectedBookmark.publishedAt)}</dd></div>}
                      <div><dt>收錄時間</dt><dd>{displayFullDate(selectedBookmark.createdAt)}</dd></div>
                      <div><dt>內容長度</dt><dd>{selectedBookmark.wordCount ? `${selectedBookmark.wordCount.toLocaleString("zh-TW")} 字` : "尚未取得"}</dd></div>
                      {selectedBookmark.lang && <div><dt>語言</dt><dd>{selectedBookmark.lang}</dd></div>}
                      {selectedBookmark.contentType && <div><dt>類型</dt><dd>{selectedBookmark.contentType}</dd></div>}
                    </dl>
                    {selectedBookmark.error && <p className="detail-error">{friendlyError(selectedBookmark.error)}</p>}
                  </div>

                  <div className="detail-actions">
                    <button type="button" disabled={selectedBookmark.status === "processing"} onClick={() => void copyMarkdown(selectedBookmark)}>複製 Markdown</button>
                    <button type="button" disabled={selectedBookmark.status === "processing"} onClick={() => void copyJson(selectedBookmark)}>複製 AI 用 JSON</button>
                    {["failed", "partial"].includes(selectedBookmark.status) && (
                      <button type="button" disabled={retryingId === selectedBookmark.id} onClick={() => void retry(selectedBookmark.id)}>
                        {retryingId === selectedBookmark.id ? "重試中…" : "重新擷取"}
                      </button>
                    )}
                    {confirmDeleteId === selectedBookmark.id ? (
                      <div className="delete-confirm">
                        <span>確定刪除這筆收藏？</span>
                        <div>
                          <button type="button" autoFocus onClick={() => setConfirmDeleteId(null)}>取消</button>
                          <button type="button" onClick={() => void remove(selectedBookmark.id)}>確認刪除</button>
                        </div>
                      </div>
                    ) : (
                      <button className="danger-action" type="button" onClick={() => setConfirmDeleteId(selectedBookmark.id)}>刪除收藏</button>
                    )}
                  </div>
                </aside>
              </div>

              <div className={notice ? "toast show" : "toast"} role="status" aria-live="polite">
                {notice}
              </div>
            </div>
          );
        })()}
      </dialog>
    </main>
  );
}
