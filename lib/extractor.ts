const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;
const PREVIEW_IMAGE_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 15 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024;

const PREVIEW_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref_src",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".test",
  ".invalid",
  ".example",
];

export type ExtractionStatus = "ready" | "partial";

export type ExtractedPage = {
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  title: string;
  description: string;
  siteName: string;
  author: string;
  publishedAt: string | null;
  lang: string | null;
  contentType: string;
  status: ExtractionStatus;
  excerpt: string;
  markdown: string;
  raw: Uint8Array;
  rawExtension: string;
  imageUrl: string | null;
  faviconUrl: string | null;
  wordCount: number;
  fetchMethod: string;
};

export type CapturedPreviewImage = {
  bytes: Uint8Array;
  contentType: string;
  sourceUrl: string;
};

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * Normalizes a submitted URL and rejects targets that are unsafe for a
 * server-side fetch. Every redirect is passed through the same validation.
 * DNS rebinding protection is ultimately also enforced by the hosting fetch
 * runtime; IP literals and obvious private/special hostnames are rejected here.
 */
export function normalizeAndValidateUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new ExtractionError("A URL is required.");

  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(value)
    ? value
    : `https://${value}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ExtractionError("The submitted URL is not valid.");
  }

  validatePublicHttpUrl(url);
  url.hash = "";
  removeTrackingParameters(url);

  if ((url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  return url.toString();
}

export async function extractUrl(
  input: string,
  options: { timeoutMs?: number } = {},
): Promise<ExtractedPage> {
  const requestedUrl = normalizeAndValidateUrl(input);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetched = await fetchWithRedirects(requestedUrl, controller.signal, timeoutMs);
    const mime = normalizeContentType(fetched.response.headers.get("content-type"));
    const kind = classifyResource(mime, fetched.finalUrl);
    const byteLimit = kind === "pdf" || kind === "image"
      ? MAX_BINARY_BYTES
      : MAX_HTML_BYTES;
    let raw: Uint8Array;
    try {
      raw = await readResponseBytes(fetched.response, byteLimit);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ExtractionError(`The page did not finish responding within ${Math.ceil(timeoutMs / 1000)} seconds.`);
      }
      throw error;
    }

    if (kind === "html" || (kind === "text" && looksLikeHtml(raw))) {
      return extractHtmlDocument({
        requestedUrl,
        finalUrl: fetched.finalUrl,
        response: fetched.response,
        raw,
        contentType: mime || "text/html",
      });
    }

    if (kind === "pdf") {
      return extractBinaryDocument({
        requestedUrl,
        finalUrl: fetched.finalUrl,
        raw,
        contentType: mime || "application/pdf",
        resourceType: "PDF",
        rawExtension: "pdf",
        fetchMethod: "http-pdf",
      });
    }

    if (kind === "image") {
      return extractBinaryDocument({
        requestedUrl,
        finalUrl: fetched.finalUrl,
        raw,
        contentType: mime || "application/octet-stream",
        resourceType: "Image",
        rawExtension: extensionForMime(mime, fetched.finalUrl),
        fetchMethod: "http-image",
        isImage: true,
      });
    }

    if (kind === "text") {
      const text = decodeResponseText(raw, fetched.response.headers.get("content-type"));
      const title = fallbackTitle(fetched.finalUrl);
      const markdown = buildContextMarkdown({
        title,
        sourceUrl: fetched.finalUrl,
        description: "",
        author: "",
        publishedAt: null,
        body: text.trim(),
      });
      const plain = markdownToPlainText(markdown);
      return {
        requestedUrl,
        finalUrl: fetched.finalUrl,
        canonicalUrl: normalizeAndValidateUrl(fetched.finalUrl),
        title,
        description: "",
        siteName: hostnameLabel(fetched.finalUrl),
        author: "",
        publishedAt: null,
        lang: null,
        contentType: mime || "text/plain",
        status: text.trim().length >= 80 ? "ready" : "partial",
        excerpt: makeExcerpt(plain),
        markdown,
        raw,
        rawExtension: "txt",
        imageUrl: null,
        faviconUrl: null,
        wordCount: countWords(plain),
        fetchMethod: "http-text",
      };
    }

    return extractBinaryDocument({
      requestedUrl,
      finalUrl: fetched.finalUrl,
      raw,
      contentType: mime || "application/octet-stream",
      resourceType: "File",
      rawExtension: extensionForMime(mime, fetched.finalUrl),
      fetchMethod: "http-binary",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Downloads a selected preview image with the same redirect-by-redirect SSRF checks as page capture. */
export async function fetchPreviewImage(
  input: string,
  options: { timeoutMs?: number } = {},
): Promise<CapturedPreviewImage> {
  const requestedUrl = normalizeAndValidateUrl(input);
  const timeoutMs = options.timeoutMs ?? PREVIEW_IMAGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetched = await fetchWithRedirects(requestedUrl, controller.signal, timeoutMs, {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.2",
      "User-Agent": "InfoRelay/1.0 (+private bookmark preview capture)",
    });
    const declaredType = normalizeRasterImageContentType(fetched.response.headers.get("content-type"));
    if (!PREVIEW_IMAGE_TYPES.has(declaredType)) {
      throw new ExtractionError("The preview URL did not return a supported raster image.");
    }

    const bytes = await readResponseBytes(fetched.response, MAX_PREVIEW_IMAGE_BYTES);
    const contentType = sniffRasterImageType(bytes);
    if (!contentType || contentType !== declaredType) {
      throw new ExtractionError("The preview image content did not match its declared format.");
    }

    return { bytes, contentType, sourceUrl: fetched.finalUrl };
  } finally {
    clearTimeout(timeout);
  }
}

function validatePublicHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractionError("Only HTTP and HTTPS URLs can be saved.");
  }
  if (url.username || url.password) {
    throw new ExtractionError("URLs containing a username or password are not allowed.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new ExtractionError("The URL has no hostname.");

  if (hostname.includes(":")) {
    // Literal IPv6 addresses are uncommon bookmark targets and are difficult to
    // classify safely without a resolver, so reject them rather than risk SSRF.
    throw new ExtractionError("IP-literal IPv6 URLs are not supported.");
  }

  if (hostname === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new ExtractionError("Private or local network URLs cannot be fetched.");
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && !isPublicIpv4(ipv4)) {
    throw new ExtractionError("Private or special-use IP addresses cannot be fetched.");
  }

  if (!ipv4 && !hostname.includes(".")) {
    throw new ExtractionError("Single-label network hostnames cannot be fetched.");
  }

  // Common wildcard DNS services can otherwise disguise a private IPv4 target.
  if (hostname.endsWith(".nip.io") || hostname.endsWith(".sslip.io")) {
    const embedded = hostname.match(/(?:^|\.)(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?:\.|$)/);
    if (embedded) {
      const address = embedded.slice(1, 5).map(Number);
      if (address.every((part) => part >= 0 && part <= 255) && !isPublicIpv4(address)) {
        throw new ExtractionError("Private wildcard-DNS targets cannot be fetched.");
      }
    }
  }
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function isPublicIpv4([a, b]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  if (a >= 224) return false;
  return true;
}

function removeTrackingParameters(url: URL): void {
  for (const name of [...url.searchParams.keys()]) {
    const normalized = name.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_PARAMETERS.has(normalized)) {
      url.searchParams.delete(name);
    }
  }
}

async function fetchWithRedirects(
  initialUrl: string,
  signal: AbortSignal,
  timeoutMs: number,
  requestHeaders: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/pdf,image/*,text/plain;q=0.9,*/*;q=0.7",
    "User-Agent": "InfoRelay/1.0 (+private bookmark capture)",
  },
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const safeUrl = normalizeAndValidateUrl(currentUrl);
      let response: Response;
      try {
        response = await fetch(safeUrl, {
          method: "GET",
          redirect: "manual",
          signal,
          headers: requestHeaders,
        });
      } catch (error) {
        if (signal.aborted) {
          throw new ExtractionError(`The page did not respond within ${Math.ceil(timeoutMs / 1000)} seconds.`);
        }
        const detail = error instanceof Error ? error.message : "Network request failed";
        throw new ExtractionError(`Unable to fetch the page: ${detail}`);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new ExtractionError("The page returned a redirect without a destination.");
        if (redirects === MAX_REDIRECTS) {
          throw new ExtractionError(`The page redirected more than ${MAX_REDIRECTS} times.`);
        }
        await response.body?.cancel();
        currentUrl = new URL(location, safeUrl).toString();
        // The next loop validates the redirect target before it is fetched.
        continue;
      }

      if (!response.ok) {
        throw new ExtractionError(`The page returned HTTP ${response.status}.`);
      }

      return { response, finalUrl: safeUrl };
  }

  throw new ExtractionError("The page could not be fetched.");
}

async function readResponseBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ExtractionError(`The response is larger than the ${formatBytes(maximumBytes)} capture limit.`);
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new ExtractionError(`The response is larger than the ${formatBytes(maximumBytes)} capture limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function extractHtmlDocument(input: {
  requestedUrl: string;
  finalUrl: string;
  response: Response;
  raw: Uint8Array;
  contentType: string;
}): ExtractedPage {
  const html = decodeResponseText(input.raw, input.response.headers.get("content-type"));
  const bodyHtml = selectArticleHtml(html);
  const metadata = parseHtmlMetadata(html, input.finalUrl, bodyHtml);
  const bodyMarkdown = htmlToMarkdown(bodyHtml, input.finalUrl);
  const bodyPlain = markdownToPlainText(bodyMarkdown);

  const title = metadata.title || fallbackTitle(input.finalUrl);
  const description = metadata.description || makeExcerpt(bodyPlain, 320);
  const markdown = buildContextMarkdown({
    title,
    sourceUrl: input.finalUrl,
    description,
    author: metadata.author,
    publishedAt: metadata.publishedAt,
    body: bodyMarkdown,
  });
  const canonicalUrl = safeCanonicalUrl(metadata.canonicalUrl, input.finalUrl);

  return {
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    canonicalUrl,
    title,
    description,
    siteName: metadata.siteName || hostnameLabel(input.finalUrl),
    author: metadata.author,
    publishedAt: metadata.publishedAt,
    lang: metadata.lang,
    contentType: normalizeContentType(input.contentType) || "text/html",
    status: bodyPlain.length >= 80 ? "ready" : "partial",
    excerpt: makeExcerpt(bodyPlain || description),
    markdown,
    raw: input.raw,
    rawExtension: "html",
    imageUrl: metadata.imageUrl,
    faviconUrl: metadata.faviconUrl,
    wordCount: countWords(bodyPlain),
    fetchMethod: "http-html",
  };
}

function extractBinaryDocument(input: {
  requestedUrl: string;
  finalUrl: string;
  raw: Uint8Array;
  contentType: string;
  resourceType: string;
  rawExtension: string;
  fetchMethod: string;
  isImage?: boolean;
}): ExtractedPage {
  const title = fallbackTitle(input.finalUrl);
  const body = input.isImage
    ? `![${escapeMarkdownText(title)}](${input.finalUrl})`
    : `${input.resourceType} captured from the source URL. Text extraction is not available in the zero-dependency capture mode.`;
  const markdown = buildContextMarkdown({
    title,
    sourceUrl: input.finalUrl,
    description: `${input.resourceType} saved to the archive.`,
    author: "",
    publishedAt: null,
    body,
  });
  return {
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    canonicalUrl: normalizeAndValidateUrl(input.finalUrl),
    title,
    description: `${input.resourceType} saved to the archive.`,
    siteName: hostnameLabel(input.finalUrl),
    author: "",
    publishedAt: null,
    lang: null,
    contentType: input.contentType,
    status: "partial",
    excerpt: `${input.resourceType} saved to the archive.`,
    markdown,
    raw: input.raw,
    rawExtension: input.rawExtension,
    imageUrl: input.isImage ? input.finalUrl : null,
    faviconUrl: null,
    wordCount: 0,
    fetchMethod: input.fetchMethod,
  };
}

type HtmlMetadata = {
  title: string;
  description: string;
  siteName: string;
  author: string;
  publishedAt: string | null;
  lang: string | null;
  canonicalUrl: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
};

type ImageCandidateSource = "og" | "twitter" | "jsonld-primary" | "jsonld" | "image-src" | "article-figure" | "article";

type ImageCandidate = {
  value: string;
  source: ImageCandidateSource;
  width?: number;
  height?: number;
  alt?: string;
  signature?: string;
  hidden?: boolean;
  order: number;
};

function parseHtmlMetadata(html: string, baseUrl: string, articleHtml: string): HtmlMetadata {
  const meta = new Map<string, string>();
  const metaTags: Array<Record<string, string>> = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    metaTags.push(attributes);
    const key = (attributes.property || attributes.name || attributes.itemprop || "").toLowerCase();
    const value = attributes.content;
    if (key && value && !meta.has(key)) meta.set(key, cleanField(value, 4_000));
  }

  let canonicalUrl: string | null = null;
  let faviconUrl: string | null = null;
  let imageSourceUrl: string | null = null;
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const rel = (attributes.rel || "").toLowerCase().split(/\s+/);
    if (!canonicalUrl && rel.includes("canonical")) {
      canonicalUrl = resolveHttpUrl(attributes.href, baseUrl);
    }
    if (!faviconUrl && rel.some((value) => value === "icon" || value === "shortcut" || value === "apple-touch-icon")) {
      faviconUrl = resolveHttpUrl(attributes.href, baseUrl);
    }
    if (!imageSourceUrl && rel.includes("image_src")) {
      imageSourceUrl = resolveHttpUrl(attributes.href, baseUrl);
    }
  }

  const jsonLd = parseJsonLd(html);
  const titleElement = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const htmlAttributes = parseAttributes(html.match(/<html\b[^>]*>/i)?.[0] || "");

  const title = firstNonEmpty(
    meta.get("og:title"),
    meta.get("twitter:title"),
    jsonLd.title,
    titleElement,
  );
  const description = firstNonEmpty(
    meta.get("description"),
    meta.get("og:description"),
    meta.get("twitter:description"),
    jsonLd.description,
  );
  const author = firstNonEmpty(
    meta.get("author"),
    meta.get("article:author"),
    jsonLd.author,
  );
  const publishedAt = firstNonEmpty(
    meta.get("article:published_time"),
    meta.get("date"),
    meta.get("datepublished"),
    jsonLd.publishedAt,
  ) || null;

  return {
    title: cleanField(title, 600),
    description: cleanField(description, 4_000),
    siteName: cleanField(firstNonEmpty(meta.get("og:site_name"), jsonLd.siteName), 300),
    author: cleanField(author, 500),
    publishedAt: publishedAt ? cleanField(publishedAt, 200) : null,
    lang: cleanField(firstNonEmpty(meta.get("og:locale"), jsonLd.lang, htmlAttributes.lang), 100) || null,
    canonicalUrl: canonicalUrl || resolveHttpUrl(meta.get("og:url"), baseUrl),
    imageUrl: selectPreviewImageUrl(
      [
        ...collectMetadataImageCandidates(metaTags),
        ...jsonLd.imageCandidates,
        ...(imageSourceUrl ? [{ value: imageSourceUrl, source: "image-src" as const, order: 20_000 }] : []),
        ...collectArticleImageCandidates(articleHtml),
      ],
      baseUrl,
      faviconUrl,
    ),
    faviconUrl,
  };
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const start = tag.replace(/^<\/?[a-z\d:-]+/i, "").replace(/\/?>(?:\s*)$/, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of start.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function parseJsonLd(html: string): {
  title: string;
  description: string;
  author: string;
  publishedAt: string;
  lang: string;
  siteName: string;
  imageCandidates: ImageCandidate[];
} {
  const candidates: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = match[1].replace(/^\s*<!--|-->\s*$/g, "").trim();
      collectJsonObjects(JSON.parse(raw), candidates);
    } catch {
      // Malformed structured data should not make the whole capture fail.
    }
  }

  const preferredTypes = new Set([
    "article",
    "newsarticle",
    "blogposting",
    "techarticle",
    "webpage",
    "product",
    "videoobject",
  ]);
  const candidate = candidates.find((item) => {
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    return types.some((type) => typeof type === "string" && preferredTypes.has(type.toLowerCase()));
  }) ?? candidates.find((item) => item.headline || item.name || item.description) ?? {};

  return {
    title: jsonString(candidate.headline) || jsonString(candidate.name),
    description: jsonString(candidate.description),
    author: jsonPersonName(candidate.author),
    publishedAt: jsonString(candidate.datePublished) || jsonString(candidate.dateCreated),
    lang: jsonString(candidate.inLanguage),
    siteName: jsonPersonName(candidate.publisher),
    imageCandidates: [
      ...jsonImageCandidates(candidate.primaryImageOfPage, "jsonld-primary", 10_000),
      ...jsonImageCandidates(candidate.image, "jsonld", 11_000),
      ...jsonImageCandidates(candidate.thumbnailUrl, "jsonld", 12_000),
    ],
  };
}

function collectJsonObjects(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonObjects(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  output.push(object);
  if (object["@graph"]) collectJsonObjects(object["@graph"], output);
}

function jsonString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function jsonPersonName(value: unknown): string {
  if (Array.isArray(value)) return value.map(jsonPersonName).filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return jsonString(object.name) || jsonString(object.legalName);
  }
  return "";
}

function jsonImageCandidates(
  value: unknown,
  source: "jsonld-primary" | "jsonld",
  startingOrder: number,
): ImageCandidate[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => jsonImageCandidates(item, source, startingOrder + index));
  }
  if (typeof value === "string") {
    return [{ value, source, order: startingOrder }];
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const url = jsonString(object.contentUrl) || jsonString(object.url);
  if (!url) return [];
  return [{
    value: url,
    source,
    width: numericDimension(object.width),
    height: numericDimension(object.height),
    alt: jsonString(object.caption) || jsonString(object.name),
    order: startingOrder,
  }];
}

function collectMetadataImageCandidates(metaTags: Array<Record<string, string>>): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  let activeOg: ImageCandidate | null = null;
  let activeTwitter: ImageCandidate | null = null;

  for (const [order, attributes] of metaTags.entries()) {
    const key = (attributes.property || attributes.name || attributes.itemprop || "").toLowerCase();
    const value = attributes.content?.trim();
    if (!key || !value) continue;

    if (key === "og:image" || key === "og:image:url") {
      activeOg = { value, source: "og", order };
      candidates.push(activeOg);
      continue;
    }
    if (key === "og:image:secure_url") {
      if (activeOg) activeOg.value = value;
      else {
        activeOg = { value, source: "og", order };
        candidates.push(activeOg);
      }
      continue;
    }
    if (activeOg && key === "og:image:width") activeOg.width = numericDimension(value);
    if (activeOg && key === "og:image:height") activeOg.height = numericDimension(value);
    if (activeOg && key === "og:image:alt") activeOg.alt = cleanField(value, 500);
    if (activeOg && key === "og:image:type") activeOg.signature = value;

    if (key === "twitter:image" || key === "twitter:image:src") {
      activeTwitter = { value, source: "twitter", order };
      candidates.push(activeTwitter);
      continue;
    }
    if (activeTwitter && key === "twitter:image:alt") activeTwitter.alt = cleanField(value, 500);
  }

  return candidates;
}

function collectArticleImageCandidates(articleHtml: string): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  let order = 30_000;

  for (const match of articleHtml.matchAll(/<img\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const srcset = attributes.srcset || attributes["data-srcset"];
    const value = bestSrcsetUrl(srcset) || firstNonEmpty(
      attributes["data-original"],
      attributes["data-lazy-src"],
      attributes["data-src"],
      attributes.src,
    );
    if (!value) continue;

    const before = articleHtml.slice(0, match.index ?? 0).toLowerCase();
    const insideFigure = before.lastIndexOf("<figure") > before.lastIndexOf("</figure");
    candidates.push({
      value,
      source: insideFigure ? "article-figure" : "article",
      width: numericDimension(attributes.width),
      height: numericDimension(attributes.height),
      alt: cleanField(attributes.alt || attributes.title || "", 500),
      signature: [attributes.class, attributes.id, attributes.role, attributes["data-testid"]].filter(Boolean).join(" "),
      hidden: Object.prototype.hasOwnProperty.call(attributes, "hidden") || attributes["aria-hidden"] === "true",
      order: order++,
    });
  }

  return candidates;
}

function bestSrcsetUrl(value: string | undefined): string {
  if (!value) return "";
  const candidates = value.split(",").map((item, index) => {
    const [url, descriptor = ""] = item.trim().split(/\s+/, 2);
    const width = descriptor.endsWith("w") ? Number.parseInt(descriptor, 10) : 0;
    const density = descriptor.endsWith("x") ? Number.parseFloat(descriptor) * 1_000 : 0;
    return { url, quality: width || density || index + 1 };
  }).filter((item) => item.url && !item.url.startsWith("data:"));
  return candidates.sort((left, right) => right.quality - left.quality)[0]?.url || "";
}

function selectPreviewImageUrl(
  candidates: ImageCandidate[],
  baseUrl: string,
  faviconUrl: string | null,
): string | null {
  const sourceScore: Record<ImageCandidateSource, number> = {
    og: 500,
    twitter: 400,
    "jsonld-primary": 350,
    jsonld: 300,
    "image-src": 280,
    "article-figure": 200,
    article: 100,
  };
  const favicon = faviconUrl ? comparableUrl(faviconUrl) : null;
  const scored = new Map<string, { url: string; score: number; order: number }>();

  for (const candidate of candidates) {
    const url = resolvePublicImageUrl(candidate.value, baseUrl);
    if (!url || candidate.hidden || comparableUrl(url) === favicon) continue;
    if (/\.(?:svg|ico)(?:$|[?#])/i.test(url)) continue;

    const signature = safelyDecodeURIComponent([
      new URL(url).pathname,
      candidate.alt,
      candidate.signature,
    ].filter(Boolean).join(" ")).toLowerCase();
    if (/(^|[\s_./-])(favicon|logo|site-logo|brandmark|avatar|default-avatar|profile-pic|emoji|sprite|spacer|tracking-pixel|badge)(?=$|[\s_./-])/i.test(signature)) {
      continue;
    }

    const { width, height } = candidate;
    if ((width !== undefined && width <= 64) || (height !== undefined && height <= 64)) continue;
    if (width !== undefined && height !== undefined) {
      const area = width * height;
      if ((width < 180 && height < 180) || area < 40_000) continue;
    }

    let score = sourceScore[candidate.source];
    if (width !== undefined && width >= 600) score += 20;
    if (width !== undefined && width >= 1_000) score += 10;
    if (height !== undefined && height >= 315) score += 10;
    if (width !== undefined && height !== undefined && width * height >= 300_000) score += 10;
    if (candidate.alt && candidate.alt.trim().length >= 8) score += 5;
    if (width && height && (width / height > 5 || height / width > 5)) score -= 80;

    const key = comparableUrl(url);
    const existing = scored.get(key);
    if (!existing || score > existing.score || (score === existing.score && candidate.order < existing.order)) {
      scored.set(key, { url, score, order: candidate.order });
    }
  }

  return [...scored.values()].sort((left, right) => right.score - left.score || left.order - right.order)[0]?.url ?? null;
}

function resolvePublicImageUrl(value: string, baseUrl: string): string | null {
  const resolved = resolveHttpUrl(value, baseUrl);
  if (!resolved) return null;
  try {
    const url = new URL(resolved);
    validatePublicHttpUrl(url);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function comparableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function numericDimension(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function safelyDecodeURIComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function selectArticleHtml(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|canvas|form|dialog)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const article = withoutNoise.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if (article && stripHtml(article).length >= 80) return article;
  const main = withoutNoise.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (main && stripHtml(main).length >= 80) return main;
  return withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? withoutNoise;
}

function htmlToMarkdown(html: string, baseUrl: string): string {
  const codeBlocks: string[] = [];
  let output = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, content: string) => {
    const code = decodeHtmlEntities(stripHtml(content)).replace(/^\n+|\n+$/g, "");
    const fence = code.includes("```") ? "````" : "```";
    const token = `\u0000CODEBLOCK${codeBlocks.length}\u0000`;
    codeBlocks.push(`\n\n${fence}\n${code}\n${fence}\n\n`);
    return token;
  });

  output = output
    .replace(/<(script|style|noscript|template|svg|canvas|form|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const attributes = parseAttributes(tag);
      const source = resolveHttpUrl(attributes.src || attributes["data-src"], baseUrl);
      if (!source) return "";
      return `\n\n![${escapeMarkdownText(cleanField(attributes.alt || "Image", 300))}](${source})\n\n`;
    })
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (tag, content: string) => {
      const attributes = parseAttributes(tag.slice(0, tag.indexOf(">") + 1));
      const label = cleanField(stripHtml(content), 1_000);
      const href = resolveHttpUrl(attributes.href, baseUrl);
      if (!label) return "";
      return href ? `[${escapeMarkdownText(label)}](${href})` : label;
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, content: string) =>
      `\n\n${"#".repeat(Number(level))} ${cleanField(stripHtml(content), 2_000)}\n\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, content: string) => {
      const text = cleanField(stripHtml(content), 10_000);
      return `\n\n${text.split(/\n+/).map((line) => `> ${line}`).join("\n")}\n\n`;
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, content: string) =>
      `\n- ${cleanField(stripHtml(content), 10_000)}`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, content: string) =>
      `**${cleanField(stripHtml(content), 10_000)}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, content: string) =>
      `_${cleanField(stripHtml(content), 10_000)}_`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, content: string) => {
      const code = cleanField(stripHtml(content), 10_000);
      return code.includes("`") ? code : `\`${code}\``;
    })
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|figure|figcaption|table|tr|ul|ol|dl|dt|dd)>/gi, "\n\n")
    .replace(/<(p|div|section|article|main|figure|figcaption|table|tr|ul|ol|dl|dt|dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  output = decodeHtmlEntities(output)
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  output = output.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_match, index: string) => codeBlocks[Number(index)] || "");
  return output.replace(/\n{3,}/g, "\n\n").trim();
}

function buildContextMarkdown(input: {
  title: string;
  sourceUrl: string;
  description: string;
  author: string;
  publishedAt: string | null;
  body: string;
}): string {
  const lines = [
    `# ${escapeMarkdownText(input.title)}`,
    "",
    `Source: ${input.sourceUrl}`,
  ];
  if (input.author) lines.push(`Author: ${input.author}`);
  if (input.publishedAt) lines.push(`Published: ${input.publishedAt}`);
  if (input.description) lines.push("", input.description);
  if (input.body) lines.push("", "---", "", input.body);
  return `${lines.join("\n").trim()}\n`;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (value) => value.replace(/```/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*>]+\s*/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", hellip: "…", laquo: "«", ldquo: "“",
    lsquo: "‘", lt: "<", nbsp: " ", ndash: "–", quot: '"', raquo: "»",
    rdquo: "”", rsquo: "’", mdash: "—", copy: "©", reg: "®", trade: "™",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
        try { return String.fromCodePoint(codePoint); } catch { return match; }
      }
      return match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function resolveHttpUrl(value: string | undefined | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeCanonicalUrl(candidate: string | null, fallback: string): string {
  try {
    return normalizeAndValidateUrl(candidate || fallback);
  } catch {
    return normalizeAndValidateUrl(fallback);
  }
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? "";
}

function cleanField(value: string, maximumLength: number): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>#])/g, "\\$1");
}

function makeExcerpt(value: string, length = 360): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= length ? clean : `${clean.slice(0, length - 1).trimEnd()}…`;
}

function countWords(value: string): number {
  const cjk = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const other = value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
    .match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return cjk + other;
}

function fallbackTitle(value: string): string {
  const url = new URL(value);
  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
  if (lastSegment) {
    try {
      const decoded = decodeURIComponent(lastSegment).replace(/[-_]+/g, " ").trim();
      if (decoded) return cleanField(decoded, 600);
    } catch {
      // Fall through to the hostname.
    }
  }
  return hostnameLabel(value);
}

function hostnameLabel(value: string): string {
  return new URL(value).hostname.replace(/^www\./i, "");
}

function normalizeContentType(value: string | null): string {
  return value?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

function normalizeRasterImageContentType(value: string | null): string {
  const normalized = normalizeContentType(value);
  if (normalized === "image/jpg" || normalized === "image/pjpeg") return "image/jpeg";
  if (normalized === "image/x-png") return "image/png";
  return normalized;
}

function classifyResource(contentType: string, url: string): "html" | "pdf" | "image" | "text" | "binary" {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") return "html";
  if (contentType === "application/pdf" || /\.pdf(?:$|[?#])/i.test(url)) return "pdf";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("text/") || contentType === "application/json" || contentType.endsWith("+json")) return "text";
  if (!contentType) return "text";
  return "binary";
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const sample = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  return sample.startsWith("<!doctype html") || sample.startsWith("<html") || /<head[\s>]/.test(sample);
}

function sniffRasterImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value)) {
    return "image/png";
  }
  const ascii = (start: number, length: number) => new TextDecoder("ascii").decode(bytes.slice(start, start + length));
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 16 && ascii(4, 4) === "ftyp") {
    const brands = ascii(8, Math.min(24, bytes.length - 8));
    if (/avif|avis/.test(brands)) return "image/avif";
  }
  return null;
}

function decodeResponseText(bytes: Uint8Array, contentType: string | null): string {
  const charset = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function extensionForMime(contentType: string, url: string): string {
  const extensions: Record<string, string> = {
    "image/avif": "avif", "image/gif": "gif", "image/jpeg": "jpg",
    "image/png": "png", "image/svg+xml": "svg", "image/webp": "webp",
    "application/json": "json", "application/zip": "zip",
  };
  if (extensions[contentType]) return extensions[contentType];
  try {
    const candidate = new URL(url).pathname.split(".").at(-1)?.toLowerCase();
    if (candidate && /^[a-z\d]{1,8}$/.test(candidate)) return candidate;
  } catch {
    // Use the generic fallback.
  }
  return "bin";
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
