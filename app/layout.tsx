import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "AI DevOps Engineer", description: "Explain, repair, and verify repository build issues." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
