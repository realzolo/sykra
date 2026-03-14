import { getProjectById } from '@/services/db';
import { getRepoBranches } from '@/services/github';
import EnhancedProjectDetail from './EnhancedProjectDetail';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const project = await getProjectById(id);
  const [branches, dict] = await Promise.all([
    getRepoBranches(project.repo, id).catch(() => [project.default_branch]),
    getDictionary(locale),
  ]);

  return <EnhancedProjectDetail project={project} branches={branches} dict={dict} />;
}
