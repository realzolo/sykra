'use client';

import {
  useCallback,
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { extractOrgFromPath, stripOrgPrefix } from '@/lib/orgPath';

export type ProjectSummary = {
  id: string;
  name: string;
  repo?: string;
};

type DashboardShellContextValue = {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  inProjectScope: boolean;
  currentProjectId: string | null;
  currentProject: ProjectSummary | null;
  projectSection: 'commits' | 'reports' | 'pipelines' | 'artifacts' | 'codebase' | 'settings';
  refreshProjects: () => Promise<void>;
};

const DashboardShellContext = createContext<DashboardShellContextValue | null>(null);

function resolveProjectSection(basePath: string): 'commits' | 'reports' | 'pipelines' | 'artifacts' | 'codebase' | 'settings' {
  if (basePath.includes('/reports')) return 'reports';
  if (basePath.includes('/pipelines')) return 'pipelines';
  if (basePath.includes('/artifacts')) return 'artifacts';
  if (basePath.includes('/codebase')) return 'codebase';
  if (basePath.match(/\/projects\/[^/]+\/settings/)) return 'settings';
  return 'commits';
}

export function DashboardShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { orgId } = extractOrgFromPath(pathname);
  const basePath = stripOrgPrefix(pathname);
  const projectMatch = basePath.match(/^\/projects\/([^/]+)(\/|$)/);
  const currentProjectId = projectMatch?.[1] ?? null;
  const inProjectScope = currentProjectId != null;
  const projectSection = resolveProjectSection(basePath);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const response = await fetch('/api/projects');
      const data = response.ok ? (await response.json()) as unknown : [];
      startTransition(() => {
        setProjects(Array.isArray(data) ? data as ProjectSummary[] : []);
      });
    } catch {
      startTransition(() => {
        setProjects([]);
      });
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [orgId, refreshProjects]);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId) ?? null,
    [currentProjectId, projects],
  );

  const value = useMemo<DashboardShellContextValue>(
    () => ({
      projects,
      projectsLoading,
      inProjectScope,
      currentProjectId,
      currentProject,
      projectSection,
      refreshProjects,
    }),
    [currentProject, currentProjectId, inProjectScope, projectSection, projects, projectsLoading, refreshProjects],
  );

  return (
    <DashboardShellContext.Provider value={value}>
      {children}
    </DashboardShellContext.Provider>
  );
}

export function useDashboardShell() {
  const context = useContext(DashboardShellContext);
  if (!context) {
    throw new Error('useDashboardShell must be used within DashboardShellProvider');
  }
  return context;
}
