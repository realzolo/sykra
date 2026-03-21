'use client';

import { useProject } from '@/lib/projectContext';
import { useProjectBranches } from '@/lib/useProjectBranches';
import ProjectCodebaseClient from '@/components/project/ProjectCodebaseClient';
import type { Dictionary } from '@/i18n';

export default function ProjectCodebaseView({ projectId, dict }: { projectId: string; dict: Dictionary }) {
  const { project } = useProject();
  const branches = useProjectBranches(projectId, project?.default_branch);

  if (!project) return null;

  return <ProjectCodebaseClient project={project} branches={branches} dict={dict} />;
}
