import { getProjects } from '@/services/db';
import ProjectsClient from './ProjectsClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const locale = await getLocale();
  const [projects, dict] = await Promise.all([getProjects(), getDictionary(locale)]);

  return <ProjectsClient initialProjects={projects} dict={dict} />;
}
