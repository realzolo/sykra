'use client';

import { useState, useMemo } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button, InputGroup } from '@heroui/react';
import { toast } from 'sonner';
import { FolderOpen } from 'lucide-react';
import ProjectCard from '@/components/project/ProjectCard';
import AddProjectModal from '@/components/project/AddProjectModal';
import DashboardStats from '@/components/dashboard/DashboardStats';
import type { Dictionary } from '@/i18n';

type Project = {
  id: string; name: string; repo: string;
  description?: string; default_branch: string; ruleset_id?: string;
};

export default function ProjectsClient({ initialProjects, dict }: { initialProjects: Project[]; dict: Dictionary }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(p => p.name.toLowerCase().includes(q) || p.repo.toLowerCase().includes(q));
  }, [projects, search]);

  async function refresh() {
    const res = await fetch('/api/projects');
    setProjects(await res.json());
  }

  async function handleDelete(id: string) {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    toast.success(dict.projects.projectDeleted);
    setProjects(prev => prev.filter(p => p.id !== id));
  }

  function handleUpdate(updated: Project) {
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-4 max-w-[1200px] mx-auto w-full flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{dict.projects.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{dict.projects.description}</p>
          </div>
          <Button onPress={() => setShowAdd(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            {dict.projects.addProject}
          </Button>
        </div>
      </div>

      {/* Stats */}
      {projects.length > 0 && (
        <div className="border-b border-border bg-card shrink-0">
          <div className="px-6 py-4 max-w-[1200px] mx-auto w-full">
            <DashboardStats dict={dict} />
          </div>
        </div>
      )}

      {/* Toolbar */}
      {projects.length > 0 && (
        <div className="border-b border-border bg-card shrink-0">
          <div className="px-6 py-3 max-w-[1200px] mx-auto w-full flex items-center justify-between gap-3">
            <InputGroup className="max-w-xs">
              <InputGroup.Prefix>
                <Search className="size-3.5 text-muted-foreground" />
              </InputGroup.Prefix>
              <InputGroup.Input
                placeholder={dict.projects.searchProjects}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </InputGroup>
            <span className="text-xs text-muted-foreground">{filtered.length} 个项目</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {projects.length === 0 ? (
          <div className="max-w-[1200px] mx-auto w-full flex flex-col items-start justify-center gap-3 px-6 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FolderOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-medium">{dict.projects.noProjectsEmpty}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{dict.projects.noProjectsEmptyDescription}</p>
            </div>
            <Button onPress={() => setShowAdd(true)} size="sm" className="gap-1.5 mt-1">
              <Plus className="h-4 w-4" />
              {dict.projects.addProject}
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="max-w-[1200px] mx-auto w-full px-6 py-20">
            <p className="text-sm text-muted-foreground">{dict.projects.noMatchingProjects.replace('{{search}}', search)}</p>
          </div>
        ) : (
          <div className="max-w-[1200px] mx-auto w-full px-6 pb-6">
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              {/* Table header */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/40">
                <div className="w-8 shrink-0" />
                <div className="flex-1 text-xs font-medium text-muted-foreground">{dict.projects.projectName}</div>
                <div className="hidden md:block text-xs font-medium text-muted-foreground w-[200px]">{dict.common.description}</div>
                <div className="w-[140px] shrink-0" />
              </div>
              {filtered.map(p => (
                <ProjectCard key={p.id} project={p} onDelete={handleDelete} onUpdate={handleUpdate} dict={dict} />
              ))}
            </div>
          </div>
        )}
      </div>

      <AddProjectModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => { setShowAdd(false); refresh(); }}
        dict={dict}
      />
    </div>
  );
}
