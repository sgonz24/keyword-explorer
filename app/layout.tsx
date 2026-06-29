import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Keyword Explorer",
  description: "Keyword discovery clustered by journey stage and scored by opportunity.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
