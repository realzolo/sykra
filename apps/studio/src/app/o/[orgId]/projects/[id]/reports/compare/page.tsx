import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import { redirect } from 'next/navigation';
import ReportCompareClient from '@/components/report/ReportCompareClient';

export const dynamic = 'force-dynamic';

export default async function ReportComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; id: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { orgId, id } = await params;
  const { a, b } = await searchParams;

  if (!a || !b) {
    redirect(`/o/${orgId}/projects/${id}/reports`);
  }

  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <ReportCompareClient reportIdA={a} reportIdB={b} projectId={id} dict={dict} />;
}
