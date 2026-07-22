import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");
  const base = host ? new URL(`${protocol}://${host}`) : undefined;
  const image = base ? new URL("/og.png", base).toString() : undefined;

  return {
    metadataBase: base,
    title: "中轉站｜私人資訊收件匣",
    description: "貼上網址，自動保存標題、描述與乾淨正文，隨時交給 AI 使用。",
    openGraph: {
      title: "中轉站｜私人資訊收件匣",
      description: "收下網址，交出乾淨內容。",
      type: "website",
      images: image ? [{ url: image, width: 1672, height: 941, alt: "中轉站：收下網址，交出乾淨內容。" }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: "中轉站｜私人資訊收件匣",
      description: "收下網址，交出乾淨內容。",
      images: image ? [image] : undefined,
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
