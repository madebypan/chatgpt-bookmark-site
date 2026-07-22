"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

type AgentClient = {
  id: string;
  name: string;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type KnowledgeIndexStatus = {
  total: number;
  indexed: number;
  pending: number;
  failed: number;
  complete: boolean;
};

type SemanticIndexStatus = {
  configured: boolean;
  backend?: "file_search" | "sites_embeddings";
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

type GeminiEndpointProbe = {
  ok: boolean;
  status: number | null;
  upstreamStatus: string | null;
  category: string;
};

type GeminiApiDiagnostic = {
  credentialAccepted: boolean;
  fileSearchAccessible: boolean;
  keyFormat?: "auth_key" | "standard_key" | "unknown";
  models: GeminiEndpointProbe;
  fileSearchStores: GeminiEndpointProbe;
  storeSummary?: {
    count: number;
    truncated: boolean;
    namedStorePresent: boolean;
  } | null;
  countTokensPost?: GeminiEndpointProbe | null;
};

type OauthConnection = {
  clientId: string;
  clientName: string;
  redirectHost: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type AiConnectionSetupProps = {
  onClose: () => void;
  onNotice: (message: string) => void;
};

const subscribeToOrigin = () => () => {};

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function shortDate(value: string | null): string {
  if (!value) return "尚未使用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "剛剛";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function semanticErrorMessage(
  value: string,
  diagnostic: GeminiApiDiagnostic | null,
): string {
  const error = value.toLowerCase();
  if (error.includes("authentication failed")) {
    return "Gemini API 金鑰未通過驗證。請確認使用 Google AI Studio 建立的 Gemini API 金鑰。";
  }
  if (error.includes("rate limited")) {
    return "Gemini 暫時達到用量限制，請稍候約一分鐘再試。";
  }
  if (error.includes("temporarily unavailable") || error.includes("could not be reached")) {
    return "目前暫時無法連上 Gemini，稍後重新開啟這個面板即可續傳。";
  }
  if (error.includes("rejected")) {
    if (error.includes("invalid_argument")) {
      if (diagnostic?.credentialAccepted && diagnostic.fileSearchAccessible) {
        if (diagnostic.countTokensPost?.ok) {
          return "Gemini 驗證與一般 POST 呼叫都通過，只有建立 File Search 索引庫被 Google 回覆 400。問題集中在這把金鑰／專案與建立端點的相容性，不是金鑰填錯，也不是伺服器連線問題。";
        }
        if (diagnostic.countTokensPost && !diagnostic.countTokensPost.ok) {
          return "Gemini 驗證通過，但一般的 countTokens POST 探針也未通過。可能是模型、權限、請求路徑或伺服器相容性，尚不能只憑這次探針判定原因。";
        }
        return "Gemini API 與 File Search 驗證皆通過，但 Google 只在建立索引庫時回覆 400。這不是金鑰填錯，而是 File Search 建立端點的相容問題。";
      }
      return "Gemini File Search 不接受目前這把憑證。請改用 Google AI Studio 建立的 Gemini API 金鑰，而不是 Agent Platform 金鑰。";
    }
    return "Gemini 拒絕建立索引。請確認這把金鑰可使用 File Search 與 Gemini Embedding 2。";
  }
  return "語意索引目前無法完成；重新開啟這個面板即可安全重試。";
}

function keyFormatLabel(format: GeminiApiDiagnostic["keyFormat"]): string {
  if (format === "auth_key") return "Auth key（AQ 開頭）";
  if (format === "standard_key") return "傳統金鑰（AIza 開頭）";
  return "無法判定";
}

function diagnosticStatus(value: {
  status: number | null;
  upstreamStatus: string | null;
  category: string;
}): string {
  const parts = [
    value.status ? `HTTP ${value.status}` : null,
    value.upstreamStatus,
    !value.status && !value.upstreamStatus ? value.category : null,
  ].filter(Boolean);
  return parts.length ? `（${parts.join(" · ")}）` : "";
}

export function AiConnectionSetup({ onClose, onNotice }: AiConnectionSetupProps) {
  const [clients, setClients] = useState<AgentClient[]>([]);
  const [oauthConnections, setOauthConnections] = useState<OauthConnection[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<KnowledgeIndexStatus | null>(null);
  const [semanticStatus, setSemanticStatus] = useState<SemanticIndexStatus | null>(null);
  const [geminiDiagnostic, setGeminiDiagnostic] = useState<GeminiApiDiagnostic | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingOauthId, setRevokingOauthId] = useState<string | null>(null);
  const [confirmOauthRevokeId, setConfirmOauthRevokeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    () => window.location.origin,
    () => "",
  );
  const endpoint = `${origin}/mcp`;
  const installPrompt = [
    "請幫我安裝一個名為「中轉站」的 Streamable HTTP MCP：",
    endpoint,
    "請使用 OAuth 登入。出現授權頁時先停下來讓我完成 ChatGPT 登入與核准，不要要求我把任何金鑰貼進對話。",
    "安裝完成後，呼叫 list_recent_bookmarks 測試，並告訴我是否能讀到收藏。",
  ].join("\n");

  const prepareIndex = useCallback(async (signal: AbortSignal) => {
    let previousProgress = "";
    let diagnosed = false;
    for (let attempt = 0; !signal.aborted; attempt += 1) {
      const response = await fetch("/api/knowledge-index", {
        method: attempt === 0 ? "GET" : "POST",
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "無法準備 AI 讀取內容"));
      }
      const body = await response.json() as {
        status: KnowledgeIndexStatus;
        semantic: SemanticIndexStatus;
      };
      setIndexStatus(body.status);
      setSemanticStatus(body.semantic);
      if (!diagnosed && body.semantic.configured && body.semantic.error) {
        diagnosed = true;
        void fetch("/api/gemini-diagnostic", {
          cache: "no-store",
          signal,
        }).then(async (diagnosticResponse) => {
          if (!diagnosticResponse.ok) return;
          setGeminiDiagnostic(await diagnosticResponse.json() as GeminiApiDiagnostic);
        }).catch(() => undefined);
      }
      if (body.status.complete && (!body.semantic.configured || body.semantic.complete)) return;
      if (
        attempt > 0 &&
        body.semantic.error &&
        !body.semantic.storeCreating &&
        body.semantic.indexing === 0
      ) return;
      const progress = [
        body.status.indexed,
        body.status.failed,
        body.semantic.indexed,
        body.semantic.indexing,
        body.semantic.failed,
        body.semantic.storeCreating,
      ].join(":");
      if (
        progress === previousProgress &&
        attempt > 2 &&
        body.status.pending === 0 &&
        body.semantic.pending === 0 &&
        body.semantic.indexing === 0
      ) return;
      previousProgress = progress;
      await new Promise<void>((resolve) => window.setTimeout(
        resolve,
        body.semantic.indexing > 0 || body.semantic.storeCreating ? 2_500 : 300,
      ));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      Promise.all([
        fetch("/api/agent-clients", { cache: "no-store", signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error(await responseError(response, "無法讀取 AI 連線"));
            return response.json() as Promise<{ clients?: AgentClient[] }>;
          })
          .then((body) => setClients(body.clients ?? [])),
        fetch("/api/oauth-connections", { cache: "no-store", signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error(await responseError(response, "無法讀取登入連線"));
            return response.json() as Promise<{ connections?: OauthConnection[] }>;
          })
          .then((body) => setOauthConnections(body.connections ?? [])),
        prepareIndex(controller.signal),
      ])
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(reason instanceof Error ? reason.message : "無法準備 AI 連線");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [prepareIndex]);

  async function createClient() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "AI Agent" }),
      });
      if (!response.ok) throw new Error(await responseError(response, "無法產生唯讀金鑰"));
      const body = await response.json() as { client: AgentClient; token: string };
      setToken(body.token);
      setClients((current) => [body.client, ...current.filter((item) => item.id !== body.client.id)]);
      onNotice("AI 唯讀金鑰已產生，請現在存進連線設定");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法產生唯讀金鑰");
    } finally {
      setCreating(false);
    }
  }

  async function revokeClient(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/agent-clients/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "無法停用這把金鑰"));
      setClients((current) => current.filter((client) => client.id !== id));
      setConfirmRevokeId(null);
      setToken(null);
      onNotice("AI 唯讀金鑰已停用");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法停用這把金鑰");
    } finally {
      setRevokingId(null);
    }
  }

  async function revokeOauth(id: string) {
    setRevokingOauthId(id);
    setError(null);
    try {
      const response = await fetch(`/api/oauth-connections/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "無法停用這個登入連線"));
      setOauthConnections((current) => current.filter((connection) => connection.clientId !== id));
      setConfirmOauthRevokeId(null);
      onNotice("AI 登入連線已停用");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法停用這個登入連線");
    } finally {
      setRevokingOauthId(null);
    }
  }

  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      onNotice(`${label}已複製`);
    } catch {
      setError(`無法自動複製${label}，請長按文字複製。`);
    }
  }

  const preparing = Boolean(indexStatus && !indexStatus.complete && indexStatus.pending > 0);

  return (
    <section className="shortcut-setup ai-connection-setup" aria-labelledby="ai-connection-title">
      <div className="shortcut-heading">
        <div>
          <span className="section-eyebrow">Claude · Codex · ChatGPT</span>
          <h2 id="ai-connection-title">連接 AI</h2>
          <p>安裝一次，之後 AI 會按需要搜尋與讀取相關收藏。</p>
        </div>
        <button className="quiet-button shortcut-close" type="button" onClick={onClose}>關閉</button>
      </div>

      <div className="permission-note">
        <span aria-hidden="true">✓</span>
        <p><strong>連線只有讀取權限。</strong>AI 可以搜尋正文與查看來源，不能新增、修改或刪除收藏。</p>
      </div>

      {error && <p className="shortcut-error" role="alert">{error}</p>}

      <div className="index-status" aria-live="polite">
        <div>
          <span>AI 可讀內容</span>
          <strong>{indexStatus ? `${indexStatus.indexed} / ${indexStatus.total} 筆` : "正在確認…"}</strong>
        </div>
        {indexStatus && indexStatus.total > 0 && (
          <progress max={indexStatus.total} value={indexStatus.indexed} aria-label="AI 內容準備進度" />
        )}
        <small>{preparing ? "正在背景整理既有收藏，不影響繼續使用。" : indexStatus?.failed ? `${indexStatus.failed} 筆內容會在下次讀取時重試。` : "新收藏會自動準備給 AI。"}</small>
        <div className="semantic-index-row">
          <span>語意問答索引</span>
          <strong>{semanticStatus?.configured
            ? `${semanticStatus.indexed} / ${semanticStatus.total} 筆`
            : "等待安全設定"}</strong>
        </div>
        {semanticStatus?.configured && semanticStatus.total > 0 && (
          <progress
            max={semanticStatus.total}
            value={semanticStatus.indexed}
            aria-label="語意問答索引進度"
          />
        )}
        <small>{!semanticStatus?.configured
          ? "設定 Sites 伺服器密鑰後會自動建立，不會把金鑰放進瀏覽器。"
          : semanticStatus.complete
            ? "可以從 ChatGPT 進行跨收藏語意問答。"
            : semanticStatus.error
              ? "語意索引暫時無法完成，之後會安全重試。"
              : "正在分批建立語意索引，可先繼續使用精確搜尋。"}</small>
        {semanticStatus?.backend === "sites_embeddings" && (
          <small>目前使用 Sites D1＋Gemini Embedding 2；不用等待 Google File Search Store。</small>
        )}
        {semanticStatus?.configured && semanticStatus.error && (
          <div className="semantic-index-error">
            <p className="shortcut-error" role="alert">
              {semanticErrorMessage(semanticStatus.error, geminiDiagnostic)}
            </p>
            {geminiDiagnostic && (
              <small aria-label="Gemini API 檢查結果">
                API 檢查：Gemini {geminiDiagnostic.credentialAccepted ? "通過" : "未通過"}
                {diagnosticStatus(geminiDiagnostic.models)}
                {` · File Search ${geminiDiagnostic.fileSearchAccessible ? "通過" : "未通過"}`}
                {diagnosticStatus(geminiDiagnostic.fileSearchStores)}
                {geminiDiagnostic.countTokensPost
                  ? ` · POST 探針 ${geminiDiagnostic.countTokensPost.ok ? "通過" : "未通過"}${diagnosticStatus(geminiDiagnostic.countTokensPost)}`
                  : " · POST 探針 未執行"}
                {geminiDiagnostic.storeSummary
                  ? ` · 雲端索引庫 ${geminiDiagnostic.storeSummary.count}${geminiDiagnostic.storeSummary.truncated ? "+" : ""} 個${geminiDiagnostic.storeSummary.namedStorePresent ? "（含同名庫）" : ""}`
                  : " · 雲端索引庫 無法確認"}
                {` · 金鑰格式 ${keyFormatLabel(geminiDiagnostic.keyFormat)}`}
              </small>
            )}
            <details className="connection-details">
              <summary>查看診斷代碼</summary>
              <code>{semanticStatus.error}</code>
            </details>
          </div>
        )}
      </div>

      <div className="connection-method">
        <div className="connection-method-heading">
          <div>
            <h3>用 ChatGPT 登入</h3>
            <p>推薦。把安裝指令交給 AI，連線時用目前的 ChatGPT 帳號核准一次。</p>
          </div>
          <span className="recommended-label">推薦</span>
        </div>
        <CopyField label="MCP 網址" value={endpoint || "/mcp"} onCopy={() => copyValue(endpoint, "MCP 網址")} />
        <button
          className="connection-action"
          type="button"
          disabled={!origin}
          onClick={() => void copyValue(installPrompt, "給 AI 的安裝指令")}
        >
          複製給 AI 的安裝指令
        </button>
        {oauthConnections.length > 0 && (
          <div className="device-list oauth-connection-list" aria-label="已核准的 AI 登入連線">
            {oauthConnections.map((connection) => (
              <div className="device-row" key={connection.clientId}>
                <div>
                  <strong>{connection.clientName}</strong>
                  <span>{connection.redirectHost} · {connection.lastUsedAt ? `上次使用 ${shortDate(connection.lastUsedAt)}` : `建立於 ${shortDate(connection.createdAt)}`}</span>
                </div>
                {confirmOauthRevokeId === connection.clientId ? (
                  <span className="device-revoke-confirm">
                    <button type="button" onClick={() => setConfirmOauthRevokeId(null)}>取消</button>
                    <button type="button" disabled={revokingOauthId === connection.clientId} onClick={() => void revokeOauth(connection.clientId)}>
                      {revokingOauthId === connection.clientId ? "停用中…" : "確認停用"}
                    </button>
                  </span>
                ) : (
                  <button className="device-revoke" type="button" onClick={() => setConfirmOauthRevokeId(connection.clientId)}>停用</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="connection-details">
        <summary>AI 只接受 Bearer 金鑰時</summary>
        <div className="connection-details-body">
          <p>這是備用方式。每個 AI 使用獨立金鑰；中轉站只保存不可還原的雜湊，明文只顯示一次。</p>

          {token ? (
            <div className="shortcut-token-state">
              <div className="one-time-note">
                <strong>現在把金鑰存進 AI 的秘密設定</strong>
                <span>關閉或重新整理後不會再顯示。</span>
              </div>
              <CopyField label="MCP 網址" value={endpoint || "/mcp"} onCopy={() => copyValue(endpoint, "MCP 網址")} />
              <CopyField label="Authorization Bearer 金鑰" value={token} secret onCopy={() => copyValue(token, "AI 唯讀金鑰")} />
            </div>
          ) : (
            <>
              {clients.length > 0 && (
                <div className="device-list" aria-label="已啟用的 AI 唯讀金鑰">
                  {clients.map((client) => (
                    <div className="device-row" key={client.id}>
                      <div>
                        <strong>{client.name}</strong>
                        <span>尾碼 {client.tokenHint} · {client.lastUsedAt ? `上次使用 ${shortDate(client.lastUsedAt)}` : `建立於 ${shortDate(client.createdAt)}`}</span>
                      </div>
                      {confirmRevokeId === client.id ? (
                        <span className="device-revoke-confirm">
                          <button type="button" onClick={() => setConfirmRevokeId(null)}>取消</button>
                          <button type="button" disabled={revokingId === client.id} onClick={() => void revokeClient(client.id)}>
                            {revokingId === client.id ? "停用中…" : "確認停用"}
                          </button>
                        </span>
                      ) : (
                        <button className="device-revoke" type="button" onClick={() => setConfirmRevokeId(client.id)}>停用</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <button className="connection-action" type="button" disabled={creating || loading || clients.length >= 5} onClick={() => void createClient()}>
                {creating ? "正在產生…" : "產生備用唯讀金鑰"}
              </button>
            </>
          )}
        </div>
      </details>
    </section>
  );
}

function CopyField({
  label,
  value,
  secret = false,
  onCopy,
}: {
  label: string;
  value: string;
  secret?: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="copy-field">
      <span>{label}</span>
      <div>
        <code className={secret ? "secret-value" : undefined}>{value}</code>
        <button type="button" onClick={onCopy}>複製</button>
      </div>
    </div>
  );
}
