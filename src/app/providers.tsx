'use client';

import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="light">
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
