import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import ProjectArtifactsView from '@/components/project/ProjectArtifactsView';

export const dynamic = 'force-dynamic';

export default async function ProjectArtifactsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <ProjectArtifactsView projectId={id} dict={dict} />;
}
