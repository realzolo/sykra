'use client';

import { useState, useMemo } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button, Input, InputGroup } from '@heroui/react';
import { toast } from 'sonner';
import { FolderOpen } from 'lucide-react';
import ProjectCard from '@/components/project/ProjectCard';
import AddProjectModal from '@/components/project/AddProjectModal';
import DashboardStats from '@/components/dashboard/DashboardStats';

type Project = {
  id: string; name: string; repo: string;
  description?: string; default_branch: string; ruleset_id?: string;
};

export default function ProjectsClient({ initialProjects }: { initialProjects: Project[] }) {
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
    toast.success('项目已删除');
    setProjects(prev => prev.filter(p => p.id !== id));
  }

  function handleUpdate(updated: Project) {
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">项目</h1>
            <p className="text-sm text-muted-foreground mt-0.5">管理 GitHub 仓库代码审查</p>
          </div>
          <Button onPress={() => setShowAdd(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            添加项目
          </Button>
        </div>
      </div>

      {/* Stats */}
      {projects.length > 0 && (
        <div className="px-6 py-4 border-b border-border bg-background shrink-0">
          <DashboardStats />
        </div>
      )}

      {/* Toolbar */}
      {projects.length > 0 && (
        <div className="px-6 py-3 border-b border-border bg-background shrink-0 flex items-center justify-between gap-3">
          <InputGroup className="max-w-xs">
            <InputGroup.Prefix>
              <Search className="size-3.5 text-muted-foreground" />
            </InputGroup.Prefix>
            <InputGroup.Input
              placeholder="搜索项目..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </InputGroup>
          <span className="text-xs text-muted-foreground">{filtered.length} 个项目</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {projects.length === 0 ? (
          <div className="flex flex-col items-start justify-center gap-3 px-6 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FolderOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-medium">还没有项目</h3>
              <p className="text-sm text-muted-foreground mt-0.5">添加 GitHub 仓库开始使用代码审查功能</p>
            </div>
            <Button onPress={() => setShowAdd(true)} size="sm" className="gap-1.5 mt-1">
              <Plus className="h-4 w-4" />
              添加项目
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-20">
            <p className="text-sm text-muted-foreground">没有匹配 &quot;{search}&quot; 的项目</p>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/40">
              <div className="w-8 shrink-0" />
              <div className="flex-1 text-xs font-medium text-muted-foreground">项目名称</div>
              <div className="hidden md:block text-xs font-medium text-muted-foreground w-[200px]">描述</div>
              <div className="w-[140px] shrink-0" />
            </div>
            {filtered.map(p => (
              <ProjectCard key={p.id} project={p} onDelete={handleDelete} onUpdate={handleUpdate} />
            ))}
          </div>
        )}
      </div>

      <AddProjectModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => { setShowAdd(false); refresh(); }}
      />
    </div>
  );
}
