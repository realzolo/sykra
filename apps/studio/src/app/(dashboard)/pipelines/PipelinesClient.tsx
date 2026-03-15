"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import type { PipelineSummary } from '@/services/pipelineTypes';
import { createDefaultPipelineConfig } from '@/services/pipelineTypes';
import { withOrgPrefix } from '@/lib/orgPath';

type Project = {
  id: string;
  name: string;
  repo?: string | null;
};

export default function PipelinesClient({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pipelineName, setPipelineName] = useState('');
  const [pipelineDescription, setPipelineDescription] = useState('');

  const projectOptions = useMemo(() => projects, [projects]);

  useEffect(() => {
    let active = true;
    async function loadProjects() {
      try {
        const res = await fetch('/api/projects');
        const data = res.ok ? await res.json() : [];
        if (!active) return;
        setProjects(Array.isArray(data) ? data : []);
        const queryProject = searchParams.get('projectId');
        const initialId = queryProject || data?.[0]?.id || '';
        setSelectedProjectId(initialId);
      } catch {
        if (!active) return;
        setProjects([]);
      }
    }
    loadProjects();
    return () => {
      active = false;
    };
  }, [searchParams]);

  useEffect(() => {
    if (!selectedProjectId) return;
    let active = true;
    async function loadPipelines() {
      setLoading(true);
      try {
        const res = await fetch(`/api/pipelines?projectId=${selectedProjectId}`);
        const data = res.ok ? await res.json() : [];
        if (!active) return;
        setPipelines(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setPipelines([]);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadPipelines();
    return () => {
      active = false;
    };
  }, [selectedProjectId]);

  async function handleCreatePipeline() {
    if (!pipelineName.trim()) {
      toast.error(dict.pipelines.pipelineNameRequired);
      return;
    }
    if (!selectedProjectId) {
      toast.error(dict.pipelines.selectProject);
      return;
    }

    setCreating(true);
    try {
      const config = createDefaultPipelineConfig(pipelineName.trim(), {
        stageName: dict.pipelines.defaultStageName,
        jobName: dict.pipelines.defaultJobName,
        stepName: dict.pipelines.defaultStepName,
      });
      if (pipelineDescription.trim()) {
        config.description = pipelineDescription.trim();
      }
      const res = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          name: pipelineName.trim(),
          description: pipelineDescription.trim(),
          config,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Create failed');
      }
      const data = await res.json();
      const pipelineId = data?.pipeline?.id || data?.pipeline?.ID || data?.pipeline?.id;
      toast.success(dict.pipelines.createSuccess);
      setCreateOpen(false);
      setPipelineName('');
      setPipelineDescription('');
      if (pipelineId) {
        router.push(withOrgPrefix(pathname, `/pipelines/${pipelineId}`));
      } else {
        router.refresh();
      }
    } catch (err) {
      toast.error(dict.pipelines.createFailed);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-heading-md text-foreground">{dict.pipelines.title}</div>
            <div className="text-copy-sm text-muted-foreground">{dict.pipelines.description}</div>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="default">{dict.pipelines.new}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{dict.pipelines.new}</DialogTitle>
                <DialogDescription>{dict.pipelines.newDescription}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{dict.pipelines.pipelineName}</label>
                  <Input value={pipelineName} onChange={(e) => setPipelineName(e.target.value)} placeholder={dict.pipelines.pipelineNamePlaceholder} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{dict.common.description}</label>
                  <Input value={pipelineDescription} onChange={(e) => setPipelineDescription(e.target.value)} placeholder={dict.pipelines.pipelineDescriptionPlaceholder} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>{dict.common.cancel}</Button>
                <Button variant="default" onClick={handleCreatePipeline} disabled={creating}>
                  {creating ? dict.common.loading : dict.pipelines.create}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="px-6 py-3 border-b border-border bg-background shrink-0">
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">{dict.pipelines.selectProject}</div>
          <div className="w-64">
            <Select value={selectedProjectId} onValueChange={(value) => setSelectedProjectId(value)}>
              <SelectTrigger>
                <SelectValue placeholder={dict.projects.allProjects} />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex items-center px-4 py-2 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground gap-4">
          <div className="flex-1">{dict.common.name}</div>
          <div className="w-40">{dict.common.updatedAt}</div>
          <div className="w-32">{dict.pipelines.latestVersion}</div>
          <div className="w-24">{dict.common.actions}</div>
        </div>
        {loading && (
          <div className="px-6 py-10 text-sm text-muted-foreground">{dict.common.loading}</div>
        )}
        {!loading && pipelines.length === 0 && (
          <div className="flex flex-col items-start gap-3 px-6 py-20">
            <div className="text-heading-sm">{dict.pipelines.emptyTitle}</div>
            <div className="text-copy-sm text-muted-foreground">{dict.pipelines.emptyDescription}</div>
            <Button variant="default" onClick={() => setCreateOpen(true)}>{dict.pipelines.new}</Button>
          </div>
        )}
        {!loading && pipelines.map((pipeline) => (
          <div
            key={pipeline.id}
            className="flex items-center gap-4 px-4 py-3 border-b border-border hover:bg-muted/30 transition-soft"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{pipeline.name}</div>
              {pipeline.description && (
                <div className="text-xs text-muted-foreground truncate">{pipeline.description}</div>
              )}
            </div>
            <div className="w-40 text-xs text-muted-foreground">
              {pipeline.updated_at ? new Date(pipeline.updated_at).toLocaleString() : '--'}
            </div>
            <div className="w-32">
              <Badge variant="muted" size="sm">v{pipeline.latest_version ?? 1}</Badge>
            </div>
            <div className="w-24">
              <Button variant="ghost" size="sm" asChild>
                <Link href={withOrgPrefix(pathname, `/pipelines/${pipeline.id}`)}>{dict.common.view}</Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
