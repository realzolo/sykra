"use client";

import { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import type {
  PipelineConfig,
  PipelineJob,
  PipelineStage,
  PipelineRun,
  PipelineRunDetail,
} from '@/services/pipelineTypes';
import { createDefaultPipelineConfig, newId } from '@/services/pipelineTypes';

type JobNodeData = {
  label: string;
  steps: number;
};

const JobNode = ({ data }: { data: JobNodeData }) => (
  <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
    <div className="text-xs font-semibold text-foreground">{data.label}</div>
    <div className="text-[11px] text-muted-foreground">{data.steps} steps</div>
    <Handle type="target" position={Position.Top} className="!bg-foreground/60" />
    <Handle type="source" position={Position.Bottom} className="!bg-foreground/60" />
  </div>
);

const nodeTypes = { job: JobNode };

export default function PipelineDetailClient({ dict, pipelineId }: { dict: Dictionary; pipelineId: string }) {
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [nodes, setNodes] = useState<Node<JobNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [tabValue, setTabValue] = useState<'builder' | 'runs'>('builder');
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<PipelineRunDetail | null>(null);
  const [logText, setLogText] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);

  const stages = config?.stages ?? [];
  const jobs = config?.jobs ?? [];

  useEffect(() => {
    let active = true;
    async function loadPipeline() {
      try {
        const res = await fetch(`/api/pipelines/${pipelineId}`);
        if (!res.ok) throw new Error('Load failed');
        const data = await res.json();
        const rawConfig = data?.version?.config ?? data?.version?.Config;
        const parsedConfig: PipelineConfig = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
        const normalized = parsedConfig ?? createDefaultPipelineConfig(dict.pipelines.title, {
          stageName: dict.pipelines.defaultStageName,
          jobName: dict.pipelines.defaultJobName,
          stepName: dict.pipelines.defaultStepName,
        });
        if (!active) return;
        setConfig(normalized);
        setNodes(buildNodes(normalized, []));
        setEdges(buildEdges(normalized));
      } catch {
        if (!active) return;
        toast.error(dict.pipelines.loadFailed);
      }
    }
    loadPipeline();
    return () => {
      active = false;
    };
  }, [pipelineId, dict.pipelines.title, dict.pipelines.loadFailed]);

  useEffect(() => {
    if (!pipelineId) return;
    fetchRuns();
  }, [pipelineId]);

  async function fetchRuns() {
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/runs`);
      if (!res.ok) throw new Error('Load runs failed');
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    }
  }

  useEffect(() => {
    if (!selectedRunId) return;
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function loadRun() {
      setLoadingRun(true);
      try {
        const res = await fetch(`/api/pipeline-runs/${selectedRunId}`);
        if (!res.ok) throw new Error('Load run failed');
        const data = await res.json();
        if (!active) return;
        setRunDetail(data);
      } catch {
        if (!active) return;
      } finally {
        if (active) setLoadingRun(false);
      }
    }

    loadRun();
    interval = setInterval(() => {
      loadRun().catch(() => {});
    }, 3000);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [selectedRunId]);

  function buildNodes(cfg: PipelineConfig, prevNodes: Node<JobNodeData>[]) {
    const prevMap = new Map(prevNodes.map((node) => [node.id, node]));
    return cfg.jobs.map((job, index) => {
      const existing = prevMap.get(job.id);
      const position = existing?.position ?? {
        x: 120 + (index % 3) * 260,
        y: 80 + Math.floor(index / 3) * 160,
      };
      return {
        id: job.id,
        type: 'job',
        position,
        data: { label: job.name, steps: job.steps.length },
      };
    });
  }

  function buildEdges(cfg: PipelineConfig) {
    const edges: Edge[] = [];
    cfg.jobs.forEach((job) => {
      (job.needs ?? []).forEach((dep) => {
        edges.push({
          id: `${dep}->${job.id}`,
          source: dep,
          target: job.id,
          type: 'smoothstep',
        });
      });
    });
    return edges;
  }

  function syncEdgesToJobs(nextEdges: Edge[]) {
    if (!config) return;
    const needsMap: Record<string, string[]> = {};
    nextEdges.forEach((edge) => {
      if (!needsMap[edge.target]) needsMap[edge.target] = [];
      needsMap[edge.target].push(edge.source);
    });
    const nextJobs = jobs.map((job) => ({
      ...job,
      needs: needsMap[job.id] ?? [],
    }));
    setConfig({ ...config, jobs: nextJobs });
  }

  function onNodesChange(changes: NodeChange[]) {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }

  function onEdgesChange(changes: EdgeChange[]) {
    setEdges((prev) => {
      const next = applyEdgeChanges(changes, prev);
      syncEdgesToJobs(next);
      return next;
    });
  }

  function onConnect(connection: Connection) {
    setEdges((prev) => {
      const next = addEdge({ ...connection, type: 'smoothstep' }, prev);
      syncEdgesToJobs(next);
      return next;
    });
  }

  function handleNodeClick(_: unknown, node: Node<JobNodeData>) {
    setSelectedJobId(node.id);
  }

  function updateJob(jobId: string, updater: (job: PipelineJob) => PipelineJob) {
    if (!config) return;
    const nextJobs = config.jobs.map((job) => (job.id === jobId ? updater(job) : job));
    setConfig({ ...config, jobs: nextJobs });
    setNodes((prev) => buildNodes({ ...config, jobs: nextJobs }, prev));
  }

  function updateStages(nextStages: PipelineStage[]) {
    if (!config) return;
    setConfig({ ...config, stages: nextStages });
  }

  function addJob() {
    if (!config) return;
    const jobId = newId('job');
    const stepId = newId('step');
    const newJob: PipelineJob = {
      id: jobId,
      name: dict.pipelines.defaultJobName,
      steps: [{ id: stepId, name: dict.pipelines.defaultStepName, type: 'shell', script: 'echo "step"' }],
    };
    const nextJobs = [...config.jobs, newJob];
    let nextStages = config.stages;
    if (nextStages.length === 0) {
      const stageId = newId('stage');
      nextStages = [{ id: stageId, name: dict.pipelines.defaultStageName, jobIds: [jobId] }];
    } else {
      nextStages = nextStages.map((stage, index) =>
        index === 0 ? { ...stage, jobIds: [...stage.jobIds, jobId] } : stage
      );
    }
    setConfig({ ...config, jobs: nextJobs, stages: nextStages });
    setNodes((prev) => buildNodes({ ...config, jobs: nextJobs }, prev));
  }

  function deleteJob(jobId: string) {
    if (!config) return;
    const nextJobs = config.jobs.filter((job) => job.id !== jobId);
    const nextStages = config.stages.map((stage) => ({
      ...stage,
      jobIds: stage.jobIds.filter((id) => id !== jobId),
    }));
    const nextEdges = edges.filter((edge) => edge.source !== jobId && edge.target !== jobId);
    setConfig({ ...config, jobs: nextJobs, stages: nextStages });
    setEdges(nextEdges);
    setNodes((prev) => buildNodes({ ...config, jobs: nextJobs }, prev));
    if (selectedJobId === jobId) {
      setSelectedJobId(null);
    }
  }

  function addStage() {
    if (!config) return;
    const stageId = newId('stage');
    const nextStages = [...config.stages, { id: stageId, name: `${dict.pipelines.stage} ${config.stages.length + 1}`, jobIds: [] }];
    updateStages(nextStages);
  }

  function moveJobToStage(jobId: string, stageId: string) {
    if (!config) return;
    const nextStages = config.stages.map((stage) => ({
      ...stage,
      jobIds: stage.id === stageId
        ? Array.from(new Set([...stage.jobIds, jobId]))
        : stage.jobIds.filter((id) => id !== jobId),
    }));
    updateStages(nextStages);
  }

  async function savePipeline() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.name,
          description: config.description ?? '',
          config,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(dict.pipelines.saveSuccess);
    } catch {
      toast.error(dict.pipelines.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function runPipeline() {
    setRunning(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'manual' }),
      });
      if (!res.ok) throw new Error('Run failed');
      toast.success(dict.pipelines.runQueued);
      fetchRuns();
      setTabValue('runs');
    } catch {
      toast.error(dict.pipelines.runFailed);
    } finally {
      setRunning(false);
    }
  }

  async function loadLogs(stepId: string) {
    if (!selectedRunId) return;
    try {
      const res = await fetch(`/api/pipeline-runs/${selectedRunId}/logs/${stepId}?offset=0&limit=200000`);
      if (!res.ok) throw new Error('Log load failed');
      const text = await res.text();
      setLogText(text);
    } catch {
      setLogText('');
    }
  }

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;

  const runJobs = useMemo(() => runDetail?.jobs ?? [], [runDetail]);
  const runSteps = useMemo(() => runDetail?.steps ?? [], [runDetail]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-heading-md text-foreground">{config?.name ?? dict.pipelines.title}</div>
            <div className="text-copy-sm text-muted-foreground">{config?.description ?? dict.pipelines.detailSubtitle}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={savePipeline} disabled={saving}>{saving ? dict.common.loading : dict.pipelines.savePipeline}</Button>
            <Button variant="default" onClick={runPipeline} disabled={running}>{running ? dict.common.loading : dict.pipelines.runPipeline}</Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-3 border-b border-border bg-background shrink-0">
        <Tabs value={tabValue} onValueChange={(value) => setTabValue(value as 'builder' | 'runs')}>
          <TabsList className="border-b border-border px-0 bg-transparent">
            <TabsTrigger value="builder">{dict.pipelines.builder}</TabsTrigger>
            <TabsTrigger value="runs">{dict.pipelines.runs}</TabsTrigger>
          </TabsList>
          <TabsContent value="builder">
            <div className="flex gap-4 pt-4">
              <div className="flex-1 h-[560px] rounded-xl border border-border bg-muted/20 overflow-hidden">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={handleNodeClick}
                  nodeTypes={nodeTypes}
                  fitView
                >
                  <MiniMap nodeStrokeWidth={2} />
                  <Controls />
                  <Background gap={16} size={1} />
                </ReactFlow>
              </div>
              <div className="w-80 shrink-0 space-y-4">
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">{dict.pipelines.jobs}</div>
                    <Button variant="outline" size="sm" onClick={addJob}>{dict.pipelines.addJob}</Button>
                  </div>
                  <div className="space-y-2">
                    {jobs.map((job) => (
                      <button
                        key={job.id}
                        className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-soft ${selectedJobId === job.id ? 'border-accent/60 bg-muted/40' : 'border-border hover:bg-muted/30'}`}
                        onClick={() => setSelectedJobId(job.id)}
                      >
                        <div className="font-medium">{job.name}</div>
                        <div className="text-[11px] text-muted-foreground">{job.steps.length} {dict.pipelines.steps}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">{dict.pipelines.stages}</div>
                    <Button variant="outline" size="sm" onClick={addStage}>{dict.pipelines.addStage}</Button>
                  </div>
                  <div className="space-y-2">
                    {stages.map((stage) => (
                      <div key={stage.id} className="rounded-md border border-border px-3 py-2 text-xs">
                        <div className="font-medium">{stage.name}</div>
                        <div className="text-[11px] text-muted-foreground">{stage.jobIds.length} {dict.pipelines.jobs}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedJob && (
                  <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{dict.pipelines.jobDetail}</div>
                      <Button variant="ghost" size="sm" onClick={() => deleteJob(selectedJob.id)}>{dict.common.delete}</Button>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">{dict.pipelines.jobName}</label>
                      <Input
                        value={selectedJob.name}
                        onChange={(e) => updateJob(selectedJob.id, (job) => ({ ...job, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">{dict.pipelines.stage}</label>
                      <Select
                        value={stages.find((stage) => stage.jobIds.includes(selectedJob.id))?.id ?? ''}
                        onValueChange={(value) => moveJobToStage(selectedJob.id, value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={dict.pipelines.selectStage} />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>
                              {stage.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">{dict.pipelines.steps}</label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            updateJob(selectedJob.id, (job) => ({
                              ...job,
                              steps: [
                                ...job.steps,
                                { id: newId('step'), name: dict.pipelines.defaultStepName, type: 'shell', script: 'echo "step"' },
                              ],
                            }));
                          }}
                        >
                          {dict.pipelines.addStep}
                        </Button>
                      </div>
                      {selectedJob.steps.map((step, index) => (
                        <div key={step.id} className="rounded-md border border-border p-3 space-y-2">
                          <div className="flex items-center justify-between text-xs font-medium">
                            <span>{dict.pipelines.step} {index + 1}</span>
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                updateJob(selectedJob.id, (job) => ({
                                  ...job,
                                  steps: job.steps.filter((s) => s.id !== step.id),
                                }));
                              }}
                            >
                              {dict.common.delete}
                            </button>
                          </div>
                          <Input
                            value={step.name}
                            onChange={(e) => {
                              updateJob(selectedJob.id, (job) => ({
                                ...job,
                                steps: job.steps.map((s) => (s.id === step.id ? { ...s, name: e.target.value } : s)),
                              }));
                            }}
                          />
                          <Textarea
                            value={step.script}
                            onChange={(e) => {
                              updateJob(selectedJob.id, (job) => ({
                                ...job,
                                steps: job.steps.map((s) => (s.id === step.id ? { ...s, script: e.target.value } : s)),
                              }));
                            }}
                            rows={4}
                            placeholder={dict.pipelines.scriptPlaceholder}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="runs">
            <div className="grid grid-cols-[1fr_360px] gap-4 pt-4">
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="text-sm font-semibold">{dict.pipelines.runs}</div>
                  <Button variant="outline" size="sm" onClick={fetchRuns}>{dict.common.refresh}</Button>
                </div>
                {runs.length === 0 && (
                  <div className="px-4 py-10 text-sm text-muted-foreground">{dict.pipelines.noRuns}</div>
                )}
                {runs.map((run) => (
                  <button
                    key={run.id}
                    className={`w-full flex items-center justify-between px-4 py-3 border-b border-border text-left text-sm transition-soft ${selectedRunId === run.id ? 'bg-muted/40' : 'hover:bg-muted/20'}`}
                    onClick={() => {
                      setSelectedRunId(run.id);
                      setSelectedStepId(null);
                      setLogText('');
                    }}
                  >
                    <div>
                      <div className="font-medium">{run.id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString()}</div>
                    </div>
                    <Badge variant="muted" size="sm">{run.status}</Badge>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                <div className="text-sm font-semibold">{dict.pipelines.runDetail}</div>
                {loadingRun && <div className="text-xs text-muted-foreground">{dict.common.loading}</div>}
                {!loadingRun && !runDetail && (
                  <div className="text-xs text-muted-foreground">{dict.pipelines.selectRun}</div>
                )}
                {runDetail && (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">{dict.pipelines.runStatus}</div>
                    <Badge variant="muted" size="sm">{runDetail.run.status}</Badge>
                    <div className="text-xs font-medium">{dict.pipelines.jobs}</div>
                    <div className="space-y-2">
                      {runJobs.map((job) => (
                        <div key={job.id} className="rounded-md border border-border p-2">
                          <div className="flex items-center justify-between text-xs font-medium">
                            <span>{job.name}</span>
                            <Badge variant="muted" size="sm">{job.status}</Badge>
                          </div>
                          <div className="mt-2 space-y-1">
                            {runSteps.filter((step) => step.job_id === job.id).map((step) => (
                              <button
                                key={step.id}
                                className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-[11px] transition-soft ${selectedStepId === step.id ? 'bg-muted/40' : 'hover:bg-muted/20'}`}
                                onClick={() => {
                                  setSelectedStepId(step.id);
                                  loadLogs(step.id).catch(() => {});
                                }}
                              >
                                <span>{step.name}</span>
                                <Badge variant="muted" size="sm">{step.status}</Badge>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs font-medium">{dict.pipelines.logs}</div>
                    {selectedStepId ? (
                      <div className="rounded-md border border-border bg-muted/20 p-2 text-[11px] whitespace-pre-wrap max-h-56 overflow-auto">
                        {logText || dict.pipelines.noLogs}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">{dict.pipelines.selectStep}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
