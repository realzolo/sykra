import ProjectsClient from './ProjectsClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export default async function ProjectsScreen() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <ProjectsClient dict={dict} />;
}
