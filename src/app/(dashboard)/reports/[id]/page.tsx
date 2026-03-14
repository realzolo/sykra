import { getReportById } from '@/services/db';
import EnhancedReportDetailClient from './EnhancedReportDetailClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const [report, dict] = await Promise.all([getReportById(id), getDictionary(locale)]);
  return <EnhancedReportDetailClient initialReport={report} dict={dict} />;
}
