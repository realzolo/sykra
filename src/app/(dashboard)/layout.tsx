import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import OnboardingCheck from '@/components/settings/OnboardingCheck';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar locale={locale} dict={dict} />
      <main className="flex-1 overflow-hidden flex flex-col bg-background">
        <Topbar dict={dict} />
        {children}
      </main>
      <OnboardingCheck />
    </div>
  );
}
