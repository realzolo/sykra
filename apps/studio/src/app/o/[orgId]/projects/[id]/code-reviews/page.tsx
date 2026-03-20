import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import ProjectCodeReviewsView from '@/components/review/ProjectCodeReviewsView';

export const dynamic = 'force-dynamic';

export default async function ProjectCodeReviewsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <ProjectCodeReviewsView projectId={id} dict={dict} />;
}
