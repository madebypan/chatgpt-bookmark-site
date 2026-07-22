import { headers } from "next/headers";
import { LibraryApp } from "./LibraryApp";
import {
  chatGPTSignOutPath,
  getChatGPTUser,
  requireChatGPTUser,
} from "./chatgpt-auth";
import { isOwnerEmail } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (
    !user &&
    process.env.NODE_ENV === "development" &&
    await isLocalPageRequest()
  ) return <LibraryApp />;

  const authenticatedUser = user ?? await requireChatGPTUser("/");
  if (!isOwnerEmail(authenticatedUser.email)) {
    return (
      <main className="owner-denied">
        <div className="owner-denied-card">
          <span className="wordmark-mark" aria-hidden="true">↘</span>
          <h1>這是私人的中轉站</h1>
          <p>你已登入 ChatGPT，但不是這個 Site 的擁有者帳號。</p>
          <a href={chatGPTSignOutPath("/")}>切換 ChatGPT 帳號</a>
        </div>
      </main>
    );
  }

  return <LibraryApp />;
}

async function isLocalPageRequest(): Promise<boolean> {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("host") ?? "").toLowerCase();
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
}
