import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import CommandPalette from '@/components/layout/CommandPalette';
import PageTransition from '@/components/layout/PageTransition';
import MobileBottomNav from '@/components/layout/MobileBottomNav';
import { DashboardShellProvider } from '@/components/layout/DashboardShellContext';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return (
    <DashboardShellProvider>
      <div className="flex h-[100dvh] overflow-hidden bg-background">
        <Sidebar dict={dict} />
        <CommandPalette dict={dict} />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <Topbar dict={dict} locale={locale} />
          <div className="min-h-0 flex-1 overflow-hidden pb-16 lg:pb-0">
            <PageTransition>{children}</PageTransition>
          </div>
          <MobileBottomNav dict={dict} />
        </main>
      </div>
    </DashboardShellProvider>
  );
}
