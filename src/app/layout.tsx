import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "自作PCパーツECサイト | 開発準備中",
  description: "自作PCパーツECサイトのポートフォリオ開発用ページです。実際の商品販売は行いません。",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
