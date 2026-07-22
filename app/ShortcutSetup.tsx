"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type CaptureDevice = {
  id: string;
  name: string;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type ShortcutSetupProps = {
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

export function ShortcutSetup({ onClose, onNotice }: ShortcutSetupProps) {
  const [devices, setDevices] = useState<CaptureDevice[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint = useSyncExternalStore(
    subscribeToOrigin,
    () => `${window.location.origin}/api/capture`,
    () => "/api/capture",
  );

  useEffect(() => {
    let active = true;
    fetch("/api/capture-devices", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await responseError(response, "無法讀取手機設定"));
        }
        return response.json() as Promise<{ devices?: CaptureDevice[] }>;
      })
      .then((body) => {
        if (active) setDevices(body.devices ?? []);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "無法讀取手機設定");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createDevice() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/capture-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "iPhone 分享捷徑" }),
      });
      if (!response.ok) throw new Error(await responseError(response, "無法產生手機金鑰"));
      const body = await response.json() as { device: CaptureDevice; token: string };
      setToken(body.token);
      setDevices((current) => [body.device, ...current.filter((item) => item.id !== body.device.id)]);
      onNotice("手機金鑰已產生，請現在存進捷徑");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法產生手機金鑰");
    } finally {
      setCreating(false);
    }
  }

  async function revokeDevice(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/capture-devices/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "無法停用這把金鑰"));
      setDevices((current) => current.filter((device) => device.id !== id));
      setConfirmRevokeId(null);
      setToken(null);
      onNotice("手機金鑰已停用");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法停用這把金鑰");
    } finally {
      setRevokingId(null);
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

  return (
    <section className="shortcut-setup" aria-labelledby="shortcut-title">
      <div className="shortcut-heading">
        <div>
          <span className="section-eyebrow">手機分享選單</span>
          <h2 id="shortcut-title">靜默收藏</h2>
          <p>分享網址後直接收進中轉站，不開 Safari，也不用再次登入。</p>
        </div>
        <button className="quiet-button shortcut-close" type="button" onClick={onClose}>關閉</button>
      </div>

      <div className="permission-note">
        <span aria-hidden="true">✓</span>
        <p><strong>手機金鑰只有收件權限。</strong>它不能查看收藏、修改內容、重試或刪除資料。</p>
      </div>

      {error && <p className="shortcut-error" role="alert">{error}</p>}

      {loading ? (
        <div className="shortcut-loading" aria-label="正在讀取手機設定" />
      ) : token ? (
        <div className="shortcut-token-state">
          <div className="one-time-note">
            <strong>現在把金鑰存進捷徑</strong>
            <span>基於安全考量，關閉或重新整理後不會再顯示明文。</span>
          </div>
          <CopyField label="收件網址" value={endpoint} onCopy={() => copyValue(endpoint, "收件網址")} />
          <CopyField label="手機金鑰" value={token} secret onCopy={() => copyValue(token, "手機金鑰")} />
          <ShortcutSteps />
        </div>
      ) : (
        <>
          {devices.length ? (
            <div className="device-list" aria-label="已啟用的手機金鑰">
              {devices.map((device) => (
                <div className="device-row" key={device.id}>
                  <div>
                    <strong>{device.name}</strong>
                    <span>尾碼 {device.tokenHint} · {device.lastUsedAt ? `上次使用 ${shortDate(device.lastUsedAt)}` : `建立於 ${shortDate(device.createdAt)}`}</span>
                  </div>
                  {confirmRevokeId === device.id ? (
                    <span className="device-revoke-confirm">
                      <button type="button" onClick={() => setConfirmRevokeId(null)}>取消</button>
                      <button type="button" disabled={revokingId === device.id} onClick={() => void revokeDevice(device.id)}>
                        {revokingId === device.id ? "停用中…" : "確認停用"}
                      </button>
                    </span>
                  ) : (
                    <button className="device-revoke" type="button" onClick={() => setConfirmRevokeId(device.id)}>停用</button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="shortcut-empty">
              <strong>先產生一把手機專用金鑰</strong>
              <p>金鑰會放在你的 iPhone 捷徑裡；中轉站只保存不可還原的雜湊。</p>
            </div>
          )}

          <div className="shortcut-actions">
            <button className="primary-button" type="button" disabled={creating || devices.length >= 5} onClick={() => void createDevice()}>
              {creating ? "正在產生…" : devices.length ? "新增另一台裝置" : "產生手機金鑰"}
            </button>
            {devices.length >= 5 && <span>最多可同時啟用 5 把金鑰。</span>}
          </div>
          {devices.length > 0 && <ShortcutSteps compact />}
        </>
      )}
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

function ShortcutSteps({ compact = false }: { compact?: boolean }) {
  return (
    <details className="shortcut-steps" open={!compact}>
      <summary>{compact ? "查看捷徑設定方式" : "在 iPhone 捷徑裡這樣設定"}</summary>
      <ol>
        <li>捷徑接收「網址」或 Safari 網頁，接著「從輸入取得 URL」並取第一個項目。</li>
        <li>加入「取得 URL 的內容」，網址填上方的收件網址，方法選 <strong>POST</strong>。</li>
        <li>要求本文選 <strong>JSON</strong>，新增欄位 <code>url</code>，值選第一個 URL。</li>
        <li>在標頭新增 <code>Authorization</code>，值填 <code>Bearer</code>、一個空格，再接手機金鑰。</li>
        <li>從回應取得 <code>ok</code>；只有值為 <strong>true</strong> 時顯示通知：<strong>已收進中轉站</strong>。</li>
        <li>不用加入「打開 URL」。分享完成後會直接回到原本的 App。</li>
      </ol>
    </details>
  );
}
