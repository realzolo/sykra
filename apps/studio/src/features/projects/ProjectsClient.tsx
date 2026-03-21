'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Plus, Search, Github, GitBranch, MoreHorizontal, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import AddProjectModal from '@/components/project/AddProjectModal';
import EditProjectModal from '@/components/project/EditProjectModal';
import type { Dictionary } from '@/i18n';
import { useOrgRole } from '@/lib/useOrgRole';
import { withOrgPrefix } from '@/lib/orgPath';

type Project = {
  id: string; name: string; repo: string;
  description?: string; default_branch: string; ruleset_id?: string;
};

export default function ProjectsClient({ initialProjects, dict }: { initialProjects?: Project[]; dict: Dictionary }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects ?? []);
  const [loading, setLoading] = useState(!initialProjects);
  const [loadError, setLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const { isAdmin } = useOrgRole();
  const router = useRouter();
  const pathname = usePathname();

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(p => p.name.toLowerCase().includes(q) || p.repo.toLowerCase().includes(q));
  }, [projects, search]);

  async function refresh() {
    setLoadError(false);
    setLoading(true);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('projects_fetch_failed');
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleUpdate(updated: Project) {
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
  }

  useEffect(() => {
    function handleOpen() {
      if (!isAdmin) return;
      setShowAdd(true);
    }
    window.addEventListener('open-add-project', handleOpen);
    return () => window.removeEventListener('open-add-project', handleOpen);
  }, [isAdmin]);

  useEffect(() => {
    if (initialProjects) return;
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch('/api/projects');
        if (!res.ok) throw new Error('projects_fetch_failed');
        const data = await res.json();
        if (!active) return;
        setProjects(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setLoadError(true);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [initialProjects]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="dashboard-container py-8">

        {/* Page header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
            {dict.nav.projects}
          </h1>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => setShowAdd(true)}
              className="gap-1.5 h-8 text-[13px]"
            >
              <Plus className="size-3.5" />
              {dict.projects.addProject}
            </Button>
          )}
        </div>

        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[hsl(var(--ds-text-2))]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={dict.nav.searchPlaceholder}
            className="h-9 pl-9"
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="rounded-[8px] border border-border overflow-hidden divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="size-8 rounded-[6px] shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : loadError && projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.common.error}</div>
            <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => void refresh()}>
              {dict.common.refresh}
            </Button>
          </div>
        ) : filtered.length === 0 && search ? (
          <div className="py-16 text-center">
            <div className="text-[13px] text-[hsl(var(--ds-text-2))]">
              {dict.projects.noMatchingProjects?.replace('{{search}}', search) ?? `No projects matching "${search}"`}
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-16">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[hsl(var(--ds-surface-2))]">
              <Github className="size-5 text-[hsl(var(--ds-text-2))]" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-foreground">{dict.projects.noProjectsEmpty}</div>
              <div className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">{dict.projects.noProjectsEmptyDescription}</div>
            </div>
            {isAdmin && (
              <Button onClick={() => setShowAdd(true)} size="sm" className="gap-1.5 h-8 text-[13px] mt-1">
                <Plus className="size-3.5" />
                {dict.projects.addProject}
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-[8px] border border-border overflow-hidden divide-y divide-border">
            {filtered.map(p => (
              <ProjectRow
                key={p.id}
                project={p}
                dict={dict}
                canManage={isAdmin}
                onUpdate={handleUpdate}
                onOpen={() => router.push(withOrgPrefix(pathname, `/projects/${p.id}/commits`))}
              />
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <AddProjectModal
          open={showAdd}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            void refresh();
          }}
          dict={dict}
        />
      )}

    </div>
  );
}

function ProjectRow({
  project,
  dict,
  canManage,
  onUpdate,
  onOpen,
}: {
  project: Project;
  dict: Dictionary;
  canManage: boolean;
  onUpdate: (p: Project) => void;
  onOpen: () => void;
}) {
  const [showEdit, setShowEdit] = useState(false);

  return (
    <>
      <div
        className="group flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--ds-surface-1))] cursor-pointer transition-colors duration-100"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onOpen();
        }}
      >
        {/* Icon */}
        <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[hsl(var(--ds-surface-2))] border border-border shrink-0">
          <Github className="size-3.5 text-[hsl(var(--ds-text-2))]" />
        </div>

        {/* Name + repo */}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-foreground truncate">{project.name}</div>
          <div className="text-[12px] text-[hsl(var(--ds-text-2))] truncate">{project.repo}</div>
        </div>

        {/* Branch badge */}
        <div className="flex items-center gap-1.5 text-[12px] text-[hsl(var(--ds-text-2))] shrink-0">
          <GitBranch className="size-3" />
          {project.default_branch}
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 px-2.5 text-[12px]"
            onClick={onOpen}
          >
            {dict.projects.review}
          </Button>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={dict.common.actions}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => setShowEdit(true)} className="text-[13px] gap-2">
                  <Pencil className="size-3.5" />
                  {dict.common.edit}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {canManage && (
        <EditProjectModal
          project={project}
          open={showEdit}
          onClose={() => setShowEdit(false)}
          onUpdated={updated => { onUpdate(updated); setShowEdit(false); }}
          dict={dict}
        />
      )}
    </>
  );
}
