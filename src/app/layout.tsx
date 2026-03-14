import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { getLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'spec-axis',
  description: 'spec-axis app',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
