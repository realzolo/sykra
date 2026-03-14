import { getReports } from '@/services/db';
import ReportsClient from './ReportsClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const locale = await getLocale();
  const [reports, dict] = await Promise.all([getReports(), getDictionary(locale)]);

  return <ReportsClient initialReports={reports} dict={dict} />;
}
