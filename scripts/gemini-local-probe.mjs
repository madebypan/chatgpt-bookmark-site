#!/usr/bin/env node
/**
 * Gemini File Search 本機對照探針。
 *
 * 目的：用「同一把正式 key」在本機重放 Sites 伺服器的請求階梯，分辨
 * 「Google project/key 側問題」與「Sites/Cloudflare 出站請求差異」。
 *
 * 安全規則：
 * - 金鑰只從環境變數 GEMINI_API_KEY 讀取，永遠不印出、不寫檔。
 * - stdout 只輸出消毒後的欄位（HTTP status、白名單 enum、數量），可直接貼回對話。
 * - --verbose 會把 Google 原始錯誤 JSON 印到 stderr 給你自己看；那段可能含
 *   專案資訊，「不要」貼進任何對話或公開場合。
 * - 測試 Store 的 displayName 一律是 bookmark-site-probe-<時間戳>，成功建立後
 *   會立刻刪除；只有刪除失敗才會印出資源名稱，方便你手動清理。
 *
 * 用法：
 *   read -s "GEMINI_API_KEY?貼上金鑰後按 Enter（不會顯示）: " && export GEMINI_API_KEY
 *   node scripts/gemini-local-probe.mjs [--full] [--empty] [--bare] [--key-in-query] [--keep] [--verbose]
 */

const ORIGIN = "https://generativelanguage.googleapis.com";
const VERSION = "v1beta";
const TARGET_DISPLAY_NAME = "bookmark-site-library";

const flags = new Set(process.argv.slice(2));
const verbose = flags.has("--verbose");
const keyInQuery = flags.has("--key-in-query");

const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
if (!apiKey) {
  console.log("GEMINI_API_KEY 未設定。請先在同一個終端執行：");
  console.log('  read -s "GEMINI_API_KEY?貼上金鑰後按 Enter（不會顯示）: " && export GEMINI_API_KEY');
  process.exit(1);
}

function keyFormat(key) {
  if (key.startsWith("AIza")) return "standard_key（AIza 開頭）";
  if (/^AQ[A-Za-z0-9._-]{6,}$/.test(key)) return "auth_key（AQ 開頭）";
  return "unknown（非 AIza／AQ 開頭）";
}

function token(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  return /^[A-Z][A-Z\d_]{1,59}$/.test(normalized) ? normalized : "";
}

function fieldToken(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[A-Za-z][A-Za-z\d_.\[\]]{0,63}$/.test(normalized) ? normalized : "";
}

function safeCodes(bodyText) {
  const codes = { status: "", reason: "", fields: [] };
  try {
    const body = JSON.parse(bodyText);
    const error = body?.error ?? {};
    codes.status = token(error.status);
    const details = Array.isArray(error.details) ? error.details : [];
    for (const detail of details) {
      if (!codes.reason) codes.reason = token(detail?.reason);
      const violations = Array.isArray(detail?.fieldViolations)
        ? detail.fieldViolations
        : Array.isArray(detail?.field_violations)
          ? detail.field_violations
          : [];
      for (const violation of violations) {
        const field = fieldToken(violation?.field);
        if (field && codes.fields.length < 3 && !codes.fields.includes(field)) {
          codes.fields.push(field);
        }
      }
    }
  } catch {
    // 無法解析時只回報 HTTP status。
  }
  return codes;
}

async function request(label, path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (!keyInQuery) headers["X-Goog-Api-Key"] = apiKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const url = keyInQuery
    ? `${ORIGIN}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`
    : `${ORIGIN}${path}`;
  let response;
  try {
    response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body }) });
  } catch {
    console.log(`${label} → 網路錯誤（無法連線）`);
    return { status: null, bodyText: "", codes: safeCodes("") };
  }
  const bodyText = await response.text().catch(() => "");
  const codes = safeCodes(bodyText);
  const parts = [`HTTP ${response.status}`];
  if (!response.ok) {
    parts.push(codes.status || "（無 error.status）");
    parts.push(`reason:${codes.reason || "—"}`);
    parts.push(`field:${codes.fields.length ? codes.fields.join(",") : "—"}`);
    if (verbose) {
      console.error(`\n[verbose][${label}] 原始回應（可能含專案資訊，不要貼進對話）：`);
      console.error(bodyText.slice(0, 4000));
      console.error("");
    }
  }
  console.log(`${label} → ${parts.join(" · ")}`);
  return { status: response.status, bodyText, codes };
}

function parseJson(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function deleteStore(name, label) {
  try {
    const headers = keyInQuery ? {} : { "X-Goog-Api-Key": apiKey };
    const url = keyInQuery
      ? `${ORIGIN}/${VERSION}/${name}?force=true&key=${encodeURIComponent(apiKey)}`
      : `${ORIGIN}/${VERSION}/${name}?force=true`;
    const response = await fetch(url, { method: "DELETE", headers });
    if (response.ok || response.status === 404) {
      console.log(`${label} 清理 → 已刪除測試 Store`);
      return;
    }
    console.log(`${label} 清理 → 刪除失敗 HTTP ${response.status}。請到 AI Studio 手動刪除（下行含資源名稱，勿貼進公開場合）：`);
    console.log(`  ${name}`);
  } catch {
    console.log(`${label} 清理 → 刪除時網路錯誤。請到 AI Studio 手動刪除（下行含資源名稱，勿貼進公開場合）：`);
    console.log(`  ${name}`);
  }
}

async function tryCreate(label, body) {
  const result = await request(label, `/${VERSION}/fileSearchStores`, {
    method: "POST",
    ...(body === undefined ? {} : { body }),
  });
  if (result.status && result.status >= 200 && result.status < 300) {
    const name = typeof parseJson(result.bodyText).name === "string"
      ? parseJson(result.bodyText).name
      : "";
    if (/^fileSearchStores\/[A-Za-z0-9._~-]+$/.test(name)) {
      if (flags.has("--keep")) {
        console.log(`${label} 清理 → 已依 --keep 保留（請記得手動刪除）`);
      } else {
        await deleteStore(name, label);
      }
    } else {
      console.log(`${label} 清理 → 回應中沒有可辨識的 Store 名稱，無法自動刪除`);
    }
  }
  return result;
}

console.log("Gemini File Search 本機對照探針（stdout 已消毒，可直接貼回對話）");
console.log(`金鑰來源: 環境變數 GEMINI_API_KEY（不顯示）· 傳送方式: ${keyInQuery ? "?key= query 參數（--key-in-query）" : "X-Goog-Api-Key header（與 Sites 相同）"}`);
console.log(`金鑰格式: ${keyFormat(apiKey)}`);
console.log("");

const models = await request("[1] GET  models list        ", `/${VERSION}/models?pageSize=50`);
const stores = await request("[2] GET  fileSearchStores   ", `/${VERSION}/fileSearchStores?pageSize=20`);

if (stores.status === 200) {
  const body = parseJson(stores.bodyText);
  const list = Array.isArray(body.fileSearchStores) ? body.fileSearchStores : [];
  const named = list.some((store) => store?.displayName === TARGET_DISPLAY_NAME);
  const truncated = typeof body.nextPageToken === "string" && body.nextPageToken.length > 0;
  console.log(`    ↳ 既有 Store ${list.length}${truncated ? "+" : ""} 個 · 同名 ${TARGET_DISPLAY_NAME}: ${named ? "有" : "無"}`);
}

let countTokensStatus = null;
if (models.status === 200) {
  const body = parseJson(models.bodyText);
  const list = Array.isArray(body.models) ? body.models : [];
  const capable = list.find((model) =>
    typeof model?.name === "string" &&
    /^models\/[A-Za-z0-9.-]+$/.test(model.name) &&
    Array.isArray(model.supportedGenerationMethods) &&
    model.supportedGenerationMethods.includes("countTokens"));
  if (capable) {
    const probe = await request(
      "[3] POST countTokens        ",
      `/${VERSION}/${capable.name}:countTokens`,
      { method: "POST", body: JSON.stringify({ contents: [{ parts: [{ text: "diagnostic ping" }] }] }) },
    );
    countTokensStatus = probe.status;
  } else {
    console.log("[3] POST countTokens         → 跳過（模型清單中找不到支援 countTokens 的模型）");
  }
} else {
  console.log("[3] POST countTokens         → 跳過（models list 未通過）");
}

const probeName = `bookmark-site-probe-${Date.now()}`;
const create = await tryCreate(
  "[4] POST create(displayName)",
  JSON.stringify({ displayName: probeName }),
);
if (flags.has("--full")) {
  await tryCreate(
    "[4b] POST create(+embedding)",
    JSON.stringify({ displayName: `${probeName}-full`, embeddingModel: "models/gemini-embedding-2" }),
  );
}
if (flags.has("--empty")) {
  await tryCreate("[4c] POST create({})        ", JSON.stringify({}));
}
if (flags.has("--bare")) {
  await tryCreate("[4d] POST create(無 body)   ", undefined);
}

console.log("");
if (create.status && create.status >= 200 && create.status < 300) {
  console.log("結論: 本機 create 成功 → 同一把 key 在 Google 側可以建立 Store，");
  console.log("      問題偏向 Sites/Cloudflare 出站請求與本機請求的差異（HANDOFF 假說 2）。");
} else if (create.status === 400) {
  if (countTokensStatus === 200) {
    console.log("結論: 本機 create 同樣 400，且 countTokens POST 正常 →");
    console.log("      排除 Sites runtime，問題鎖定在這個 Google project/key 對 fileSearchStores.create 的相容性（HANDOFF 假說 1/3）。");
    console.log("      下一步：換一個乾淨 Google 專案的 key 對照，或帶著上面的 reason/field 代碼向 Google 回報。");
  } else {
    console.log("結論: 本機 create 400，countTokens 也未通過 → 尚不能由單一原因解釋，");
    console.log("      請一併檢查模型、權限、端點與 AI Studio 專案狀態。");
  }
} else {
  console.log("結論: 請把上面各行輸出貼回對話（stdout 已消毒），由排查方判讀。");
}
