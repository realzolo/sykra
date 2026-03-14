'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSearchParams } from 'next/navigation';
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
  const searchParams = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const view = searchParams.get('view') === 'list' ? 'list' : 'grid';

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

  useEffect(() => {
    function handleOpen() {
      setShowAdd(true);
    }
    window.addEventListener('open-add-project', handleOpen);
    return () => window.removeEventListener('open-add-project', handleOpen);
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6">
          {projects.length === 0 ? (
            <div className="flex flex-col items-start justify-center gap-3 py-20">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <FolderOpen className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-medium">{dict.projects.noProjectsEmpty}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{dict.projects.noProjectsEmptyDescription}</p>
              </div>
              <Button onClick={() => setShowAdd(true)} size="sm" className="gap-1.5 mt-1">
                <Plus className="h-4 w-4" />
                {dict.projects.addProject}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20">
              <p className="text-sm text-muted-foreground">{dict.projects.noMatchingProjects.replace('{{search}}', search)}</p>
            </div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="text-xs text-muted-foreground mb-2">Usage</div>
                  <DashboardStats dict={dict} />
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="text-xs text-muted-foreground mb-2">Alerts</div>
                  <div className="text-sm text-muted-foreground">
                    Get alerted for anomalies. Monitor your projects and get notified.
                  </div>
                  <Button variant="outline" className="mt-3 h-8 text-xs">
                    Upgrade to Observability Plus
                  </Button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold">Projects</div>
                  <div className="text-xs text-muted-foreground">{filtered.length} projects</div>
                </div>
                {view === 'grid' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {filtered.map(p => (
                      <ProjectCard key={p.id} project={p} onDelete={handleDelete} onUpdate={handleUpdate} dict={dict} view="grid" />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card divide-y divide-border">
                    {filtered.map(p => (
                      <ProjectCard key={p.id} project={p} onDelete={handleDelete} onUpdate={handleUpdate} dict={dict} view="list" />
                    ))}
                  </div>
                )}
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
