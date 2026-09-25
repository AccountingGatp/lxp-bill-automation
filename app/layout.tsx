import "./globals.css";
export const metadata = { title: "Bill Import", description: "Import vendor PO files as bills in QuickBooks Online" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
