import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import AnalyticsClient from '@/components/analytics/AnalyticsClient';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <AnalyticsClient dict={dict} />;
}
