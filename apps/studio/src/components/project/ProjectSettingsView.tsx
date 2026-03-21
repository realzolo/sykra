'use client';

import { useProject } from '@/lib/projectContext';
import ProjectConfigPanel from '@/components/project/ProjectConfigPanel';
import type { Dictionary } from '@/i18n';

export default function ProjectSettingsView({
  projectId,
  dict,
}: {
  projectId: string;
  dict: Dictionary;
}) {
  const { project } = useProject();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[980px] px-6 py-8">
        <div className="mb-8 space-y-2">
          {project ? (
            <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ds-text-2))]">
              {project.name}
            </div>
          ) : null}
          <div className="text-[28px] font-semibold tracking-[-0.03em] text-foreground">
            {dict.projects.projectConfig}
          </div>
        </div>
        <ProjectConfigPanel projectId={projectId} dict={dict} />
      </div>
    </div>
  );
}
