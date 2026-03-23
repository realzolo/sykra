import { getDictionary } from '@/i18n';
import { getLocale } from '@/lib/locale';
import { getProjectById } from '@/services/db';
import { getSession } from '@/services/auth';
import { ProjectDataProvider } from '@/lib/projectContext';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ProjectScopedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string; id: string }>;
}) {
  const { orgId, id } = await params;
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  const session = await getSession();
  if (!session) redirect('/login');

  let project;
  try {
    project = await getProjectById(id);
  } catch {
    redirect(`/o/${orgId}/projects`);
  }

  if (project.org_id !== orgId) {
    redirect(`/o/${orgId}/projects`);
  }

  return (
    <ProjectDataProvider
      project={{
        id: project.id,
        name: project.name,
        repo: project.repo,
        default_branch: project.default_branch,
        org_id: project.org_id,
        ...(project.ruleset_id ? { ruleset_id: project.ruleset_id } : {}),
      }}
      dict={dict}
    >
      <div className="h-full overflow-hidden">{children}</div>
    </ProjectDataProvider>
  );
}
