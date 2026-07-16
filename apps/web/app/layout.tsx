import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import "./globals.css";
import { RegionInit } from "@/components/region-init";
import { TopNav } from "@/components/site/top-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: t("title"),
    description: t("description"),
    icons: { icon: "/favicon.svg" },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="dark">
      <head>
      </head>
      <body className="min-h-screen font-sans antialiased" suppressHydrationWarning>
        <NextIntlClientProvider>
          <RegionInit />
          <TopNav />
          {children}
          {/* 全站质感层：边缘遮罩 + 电影颗粒（纯装饰，不拦截交互） */}
          <div className="deep-space-mask" aria-hidden />
          <div className="noise-overlay" aria-hidden />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
