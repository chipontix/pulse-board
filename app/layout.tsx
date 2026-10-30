import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Pulse Board", description: "Service status" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
