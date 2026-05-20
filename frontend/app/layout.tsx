import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Accountio — Invoice review',
  description: 'Upload invoices and review LLM-generated journal entries.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b">
          <div className="mx-auto flex h-14 max-w-6xl items-center px-6">
            <span className="text-base font-semibold">accountio</span>
            <span className="ml-2 text-sm text-(--color-muted-foreground)">
              Invoice → Journal entry
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
