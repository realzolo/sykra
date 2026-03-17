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
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-[hsl(var(--ds-border-1))] bg-background shrink-0">
        <div className="text-[16px] font-semibold text-foreground">{dict.projects.projectConfig}</div>
        {project && (
          <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{project.name}</div>
        )}
      </div>
      <div className="flex-1 overflow-auto p-8">
        <ProjectConfigPanel projectId={projectId} dict={dict} />
      </div>
    </div>
  );
}
