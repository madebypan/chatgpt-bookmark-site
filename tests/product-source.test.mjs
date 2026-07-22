import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("核心書籤與 AI routes 都存在，且公開正確方法", () => {
  const routes = [
    ["app/api/bookmarks/route.ts", ["GET", "POST"]],
    ["app/api/bookmarks/[id]/route.ts", ["GET", "DELETE"]],
    ["app/api/bookmarks/[id]/retry/route.ts", ["POST"]],
    ["app/api/bookmarks/[id]/markdown/route.ts", ["GET"]],
    ["app/api/bookmarks/[id]/preview/route.ts", ["GET"]],
    ["app/api/ai/library/route.ts", ["GET"]],
    ["app/api/ai/library.md/route.ts", ["GET"]],
    ["app/api/capture/route.ts", ["POST"]],
    ["app/api/capture-devices/route.ts", ["GET", "POST"]],
    ["app/api/capture-devices/[id]/route.ts", ["DELETE"]],
    ["app/api/agent-clients/route.ts", ["GET", "POST"]],
    ["app/api/agent-clients/[id]/route.ts", ["DELETE"]],
    ["app/api/gemini-diagnostic/route.ts", ["GET"]],
    ["app/api/knowledge-index/route.ts", ["GET", "POST"]],
    ["app/api/oauth-connections/route.ts", ["GET"]],
    ["app/api/oauth-connections/[id]/route.ts", ["DELETE"]],
    ["app/mcp/route.ts", ["GET", "POST", "DELETE"]],
    ["app/oauth/metadata/protected-resource/route.ts", ["GET"]],
    ["app/oauth/metadata/authorization-server/route.ts", ["GET"]],
    ["app/oauth/register/route.ts", ["POST"]],
    ["app/oauth/authorize/route.ts", ["GET", "POST"]],
    ["app/oauth/token/route.ts", ["POST"]],
    ["app/oauth/revoke/route.ts", ["POST"]],
  ];

  for (const [path, methods] of routes) {
    assert.equal(existsSync(join(root, path)), true, path + " 應存在");
    const source = read(path);
    for (const method of methods) {
      assert.match(
        source,
        new RegExp("export\\s+async\\s+function\\s+" + method + "\\b"),
        path + " 應公開 " + method,
      );
    }
  }

  const app = read("app/LibraryApp.tsx");
  assert.match(app, /fetch\("\/api\/bookmarks"/);
  assert.match(app, /\/api\/bookmarks\/.+\/retry/);
  assert.match(app, /\/api\/bookmarks\/.+\/markdown/);
  assert.match(app, /AiConnectionSetup/);
  const aiSetup = read("app/AiConnectionSetup.tsx");
  assert.match(aiSetup, /\/mcp/);
  assert.match(aiSetup, /\/api\/agent-clients/);
  assert.match(aiSetup, /\/api\/knowledge-index/);
  assert.match(aiSetup, /\/api\/gemini-diagnostic/);
  assert.match(aiSetup, /Gemini API 與 File Search 驗證皆通過/);
});

test("Sites 同時宣告 D1 與 R2 作為主要資料層", () => {
  const hosting = JSON.parse(read(".openai/hosting.json"));
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "ARCHIVE");
});

test("專案不再依賴 starter skeleton 或 react-loading-skeleton", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest.dependencies ?? {}, "react-loading-skeleton"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest.devDependencies ?? {}, "react-loading-skeleton"),
    false,
  );
  assert.equal(
    existsSync(join(root, "app/_sites-preview/SkeletonPreview.tsx")),
    false,
  );
  assert.doesNotMatch(read("app/page.tsx"), /SkeletonPreview|react-loading-skeleton/);
});

test("社交預覽圖存在，且 metadata 使用它", () => {
  const imagePath = join(root, "public/og.png");
  assert.equal(existsSync(imagePath), true);
  assert.ok(statSync(imagePath).size > 0, "public/og.png 不應是空檔案");

  const layout = read("app/layout.tsx");
  assert.match(layout, /new URL\("\/og\.png", base\)/);
  assert.match(layout, /summary_large_image/);
  assert.match(layout, /width:\s*1672,\s*height:\s*941/);
});

test("舊版分享網址只會安全預填，不會因 query string 自動寫入", () => {
  const app = read("app/LibraryApp.tsx");
  assert.match(app, /searchParams\.get\("url"\)/);
  assert.match(app, /searchParams\.delete\("url"\)/);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /setUrl\(sharedUrl\)/);
  assert.doesNotMatch(app, /saveUrl\(sharedUrl/);
  assert.match(app, /shareCaptureHandledRef/);
  assert.match(app, /分享網址已帶入/);
});

test("預覽圖會挑選、封存並由私人同站路由顯示", () => {
  const extractor = read("lib/extractor.ts");
  assert.match(extractor, /og:image/);
  assert.match(extractor, /twitter:image/);
  assert.match(extractor, /jsonld-primary/);
  assert.match(extractor, /collectArticleImageCandidates/);
  assert.match(extractor, /favicon\|logo\|site-logo\|brandmark\|avatar/);
  assert.match(extractor, /fetchPreviewImage/);
  assert.match(extractor, /sniffRasterImageType/);

  const storage = read("lib/storage.ts");
  assert.match(storage, /bookmarks\/\$\{id\}\/preview/);
  assert.match(storage, /artifact: "preview-image"/);

  const schema = read("db/schema.ts");
  assert.match(schema, /previewImageKey: text\("preview_image_key"\)/);

  const app = read("app/LibraryApp.tsx");
  assert.match(app, /\/api\/bookmarks\/\$\{bookmark\.id\}\/preview/);
  assert.match(app, /bookmark\.imageUrl/);
  assert.match(app, /bookmark\.faviconUrl/);
});

test("收藏條目以可存取的專注閱讀彈窗顯示正文與資訊", () => {
  const app = read("app/LibraryApp.tsx");
  const styles = read("app/globals.css");

  assert.match(app, /<dialog/);
  assert.match(app, /\.showModal\(\)/);
  assert.match(app, /aria-haspopup="dialog"/);
  assert.match(app, /aria-label="關閉收藏詳情"/);
  assert.match(app, /\/api\/bookmarks\/\$\{bookmark\.id\}\/markdown/);
  assert.match(app, /BookmarkDetailArtwork/);
  assert.match(app, /MarkdownReader/);
  assert.doesNotMatch(app, /expandedId|bookmark-details|aria-expanded=\{open\}/);

  assert.match(styles, /\.bookmark-dialog::backdrop/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) 320px/);
  assert.match(styles, /\.bookmark-dialog-content,\s*\n\.bookmark-properties[\s\S]*overflow-y:\s*auto/);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.bookmark-dialog-layout[\s\S]*display:\s*block/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.bookmark-dialog[\s\S]*width:\s*100vw[\s\S]*height:\s*100dvh/);
});

test("所有私人頁面與資料 API 都採 owner-only，變更另驗同源", () => {
  const privateRoutes = [
    "app/api/bookmarks/route.ts",
    "app/api/bookmarks/[id]/route.ts",
    "app/api/bookmarks/[id]/retry/route.ts",
    "app/api/bookmarks/[id]/markdown/route.ts",
    "app/api/bookmarks/[id]/preview/route.ts",
    "app/api/ai/library/route.ts",
    "app/api/ai/library.md/route.ts",
    "app/api/capture-devices/route.ts",
    "app/api/capture-devices/[id]/route.ts",
    "app/api/agent-clients/route.ts",
    "app/api/agent-clients/[id]/route.ts",
    "app/api/gemini-diagnostic/route.ts",
    "app/api/knowledge-index/route.ts",
    "app/api/oauth-connections/route.ts",
    "app/api/oauth-connections/[id]/route.ts",
  ];
  for (const path of privateRoutes) {
    assert.match(read(path), /assertOwnerAccess\(request\)/, `${path} 必須驗證 owner`);
  }

  for (const path of [
    "app/api/bookmarks/route.ts",
    "app/api/bookmarks/[id]/route.ts",
    "app/api/bookmarks/[id]/retry/route.ts",
    "app/api/capture-devices/route.ts",
    "app/api/capture-devices/[id]/route.ts",
    "app/api/agent-clients/route.ts",
    "app/api/agent-clients/[id]/route.ts",
    "app/api/knowledge-index/route.ts",
    "app/api/oauth-connections/[id]/route.ts",
  ]) {
    assert.match(read(path), /assertSameOriginMutation\(request\)/, `${path} 的變更必須驗證同源`);
  }

  const http = read("lib/http.ts");
  assert.match(http, /OWNER_EMAIL/);
  assert.match(http, /!submittedOrigin && !fetchSite/);
  assert.doesNotMatch(http, /CAPTURE_TOKEN|assertWriteAccess/);

  const page = read("app/page.tsx");
  assert.match(page, /requireChatGPTUser\("\/"\)/);
  assert.match(page, /isOwnerEmail\(authenticatedUser\.email\)/);

  const authorize = read("app/oauth/authorize/route.ts");
  assert.match(authorize, /assertOwnerAccess\(request\)/);
  assert.doesNotMatch(authorize, /assertSameOriginMutation\(request\)/);
  assert.match(authorize, /completeAuthorization\(request, authorizedOwnerEmail\(request\)\)/);

  const oauth = read("lib/oauth.ts");
  assert.match(oauth, /transaction_hash = \?/);
  assert.match(oauth, /owner_email = \?/);
  assert.match(oauth, /consumed_at IS NULL/);
  assert.match(oauth, /expires_at > \?/);
  assert.match(oauth, /OAUTH_CONSENT_CONTENT_SECURITY_POLICY/);

  const consentPolicy = read("lib/oauth-consent-policy.ts");
  assert.match(consentPolicy, /script-src 'self' 'unsafe-inline'/);
  assert.match(consentPolicy, /frame-src 'self'/);
  assert.match(consentPolicy, /connect-src 'self'/);
  assert.match(consentPolicy, /OAUTH_REDIRECT_FORM_ACTION_SOURCES/);
});

test("Worker 採預設拒絕，只公開登入、靜態檔、收件入口與自帶驗證的 MCP", () => {
  const worker = read("worker/index.ts");
  assert.match(worker, /authorizeOwnerRequest\(request, env, url\)/);
  assert.match(worker, /configuredOwner/);
  assert.match(worker, /oai-authenticated-user-email/);
  assert.match(worker, /process\.env\.NODE_ENV === "development"/);
  assert.match(worker, /pathname === "\/api\/capture"/);
  assert.match(worker, /pathname === "\/mcp"/);
  assert.match(worker, /pathname === "\/\.well-known\/oauth-protected-resource"/);
  assert.match(worker, /pathname === "\/oauth\/register"/);
  assert.match(worker, /pathname === "\/oauth\/token"/);
  assert.doesNotMatch(worker, /pathname === "\/oauth\/authorize"/);
  assert.match(worker, /pathname === "\/signin-with-chatgpt"/);
  assert.match(worker, /pathname === "\/og\.png"/);
});

test("手機金鑰只可新增 URL，資料庫只保存雜湊且可撤銷與限流", () => {
  const schema = read("db/schema.ts");
  assert.match(schema, /"capture_devices"/);
  assert.match(schema, /tokenHash: text\("token_hash"\)/);
  assert.match(schema, /revokedAt: text\("revoked_at"\)/);
  assert.match(schema, /rateWindowCount: integer\("rate_window_count"\)/);

  const devices = read("lib/capture-devices.ts");
  assert.match(devices, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(devices, /crypto\.subtle\.digest\(\s*"SHA-256"/);
  assert.match(devices, /relay_cap_/);
  assert.match(devices, /isNull\(captureDevices\.revokedAt\)/);
  assert.match(devices, /CAPTURE_REQUESTS_PER_HOUR/);

  const capture = read("app/api/capture/route.ts");
  assert.match(capture, /authenticateCaptureDevice\(request\)/);
  assert.match(capture, /createBookmark\(submittedUrl\)/);
  assert.match(capture, /status: 202/);
  assert.match(capture, /\{ ok: true \}/);
  assert.doesNotMatch(capture, /\{ bookmark \}/);
  assert.doesNotMatch(capture, /assertOwnerAccess/);
  assert.match(capture, /16_384/);
  assert.match(capture, /request\.body\.getReader\(\)/);
});

test("owner 可在 Site 內建立一次性手機金鑰並隨時停用", () => {
  const setup = read("app/ShortcutSetup.tsx");
  assert.match(setup, /fetch\("\/api\/capture-devices"/);
  assert.match(setup, /\/api\/capture-devices\/\$\{id\}/);
  assert.match(setup, /關閉或重新整理後不會再顯示明文/);
  assert.match(setup, /Authorization/);
  assert.match(setup, /Bearer/);
  assert.match(setup, /不用加入「打開 URL」/);
});

test("知識索引保留 R2 原文，只把可重建的分段鏡像放進 D1", () => {
  const schema = read("db/schema.ts");
  assert.match(schema, /"bookmark_chunks"/);
  assert.match(schema, /searchContentHash: text\("search_content_hash"\)/);
  assert.match(schema, /"agent_clients"/);

  const knowledge = read("lib/knowledge.ts");
  assert.match(knowledge, /KNOWLEDGE_CHUNK_TARGET = 1_600/);
  assert.match(knowledge, /getArchiveText/);
  assert.match(knowledge, /searchKnowledge/);
  assert.match(knowledge, /readKnowledgeBookmark/);
  assert.match(knowledge, /backfillKnowledgeIndex/);

  const bookmarks = read("lib/bookmarks.ts");
  assert.match(bookmarks, /indexBookmarkContent\(updated, extracted\.markdown\)/);
  assert.match(bookmarks, /deleteBookmarkIndex\(id\)/);
});

test("精確搜尋使用 D1 FTS5，語意索引金鑰只由伺服器環境提供", () => {
  const migration = read("drizzle/0007_kind_roland_deschain.sql");
  assert.match(migration, /CREATE VIRTUAL TABLE `bookmark_chunks_fts` USING fts5/);
  assert.match(migration, /tokenize='trigram'/);

  const knowledge = read("lib/knowledge.ts");
  assert.match(knowledge, /bookmark_chunks_fts MATCH \?/);
  assert.match(knowledge, /bm25\(bookmark_chunks_fts/);

  const bindings = read("cloudflare-env.d.ts");
  assert.match(bindings, /GEMINI_API_KEY\?: string/);

  const fileSearch = read("lib/file-search.ts");
  assert.match(fileSearch, /GEMINI_API_KEY/);
  assert.match(fileSearch, /fileSearchDocuments/);
  assert.match(fileSearch, /fileSearchStores/);
  assert.match(fileSearch, /status: "uploading"/);
  assert.match(fileSearch, /ne\(fileSearchDocuments\.status, "deleting"\)/);
  assert.match(fileSearch, /"deleted_during_indexing"/);
  assert.match(fileSearch, /bytes: raw\.body/);
  assert.match(fileSearch, /index\.backend === "sites_embeddings"/);
  assert.doesNotMatch(fileSearch, /advanceFileSearchIndex\(\{ limit: 3 \}\)/);

  const semanticMigration = read("drizzle/0008_mixed_fenris.sql");
  assert.match(semanticMigration, /CREATE TABLE `semantic_embeddings`/);
  assert.match(semanticMigration, /ON DELETE cascade/);
  const localSemantic = read("lib/local-semantic.ts");
  assert.match(localSemantic, /gemini-embedding-2|GEMINI_EMBEDDING_MODEL/);
  assert.match(localSemantic, /task: question answering/);
  assert.match(localSemantic, /NOT EXISTS/);
  assert.match(localSemantic, /answerWithEvidence/);

  const knowledgeRoute = read("app/api/knowledge-index/route.ts");
  assert.match(knowledgeRoute, /preferSitesEmbeddings: true/);

  const setup = read("app/AiConnectionSetup.tsx");
  assert.match(setup, /等待安全設定/);
  assert.match(setup, /for \(let attempt = 0; !signal\.aborted; attempt \+= 1\)/);
  assert.doesNotMatch(setup, /localStorage.*GEMINI_API_KEY|GEMINI_API_KEY.*localStorage/);
});

test("MCP 只接受獨立唯讀金鑰或 OAuth token，不接受手機金鑰與 SIWC header", () => {
  const adapter = read("lib/mcp-library.ts");
  assert.match(adapter, /OAUTH_ACCESS_TOKEN_PREFIX/);
  assert.match(adapter, /AGENT_TOKEN_PREFIX/);
  assert.match(adapter, /authenticateOauthAccessToken/);
  assert.match(adapter, /authenticateAgentClient/);
  assert.doesNotMatch(adapter, /relay_cap_|oai-authenticated-user-email|MCP_BEARER_TOKEN/);

  const mcp = read("lib/mcp.ts");
  assert.match(mcp, /search_library/);
  assert.match(mcp, /ask_library/);
  assert.match(mcp, /read_bookmark/);
  assert.match(mcp, /list_recent_bookmarks/);
  assert.match(mcp, /knowledge:read/);
  assert.match(mcp, /readOnlyHint: true/);
});

test("OAuth 採 SIWC owner consent、PKCE、短效 access 與 refresh family rotation", () => {
  const oauth = read("lib/oauth.ts");
  assert.match(oauth, /code_challenge_methods_supported: \["S256"\]/);
  assert.match(oauth, /AUTHORIZATION_CODE_LIFETIME_MS/);
  assert.match(oauth, /ACCESS_TOKEN_LIFETIME_MS/);
  assert.match(oauth, /oauth_token_families/);
  assert.match(oauth, /revokeTokenFamily/);
  assert.match(oauth, /consumed_at IS NULL/);
  assert.match(oauth, /configuredOwnerEmail/);

  const config = read("next.config.ts");
  assert.match(config, /\.well-known\/oauth-protected-resource/);
  assert.match(config, /\.well-known\/oauth-authorization-server/);
});
