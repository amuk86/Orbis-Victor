import type { Metadata } from "next";
import { Cinzel } from "next/font/google";
import "./globals.css";

const cinzel = Cinzel({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Orbis Victor — The die is cast",
  description: "Alea iacta est. The die is cast. Conquer the world.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className={`${cinzel.className} antialiased`}>{children}</body></html>;
}
