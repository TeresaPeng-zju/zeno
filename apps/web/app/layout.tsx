import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/site/top-nav";

export const metadata: Metadata = {
  title: "Zeno · See where you are. Navigate where you could go.",
  description:
    "Zeno maps your skills into a living career constellation — revealing your strengths, your gaps, and the most effective path to your target role.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen font-sans antialiased" suppressHydrationWarning>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
