import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);

  return {
    metadataBase: baseUrl,
    title: "镜语｜实时口播教练",
    description: "录制过程中实时观察语速、停顿、音量、镜头注视和画面构图，只在真正需要时给出一条建议。",
    openGraph: {
      title: "镜语｜实时看见，更好表达",
      description: "低干扰、重隐私的实时口播训练空间。",
      type: "website",
      locale: "zh_CN",
      images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1672, height: 941, alt: "镜语实时口播教练" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "镜语｜实时看见，更好表达",
      description: "低干扰、重隐私的实时口播训练空间。",
      images: [new URL("/og.png", baseUrl).toString()],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
