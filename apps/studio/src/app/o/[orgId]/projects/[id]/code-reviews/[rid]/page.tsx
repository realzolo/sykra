import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import CodeReviewDetailClient from '@/components/review/CodeReviewDetailClient';

export const dynamic = 'force-dynamic';

export default async function ProjectCodeReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string; rid: string }>;
}) {
  const { id, rid } = await params;
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <CodeReviewDetailClient runId={rid} projectId={id} dict={dict} />;
}
