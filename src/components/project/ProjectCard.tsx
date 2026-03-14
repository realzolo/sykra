'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Github, Trash2, Pencil, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button, Tooltip } from '@heroui/react';
import EditProjectModal from './EditProjectModal';

type Project = {
  id: string; name: string; repo: string;
  description?: string; default_branch: string; ruleset_id?: string;
};

export default function ProjectCard({ project: initialProject, onDelete, onUpdate }: {
  project: Project;
  onDelete: (id: string) => void;
  onUpdate?: (updated: Project) => void;
}) {
  const router = useRouter();
  const [project, setProject] = useState<Project>(initialProject);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleUpdated(updated: Project) {
    setProject(updated);
    setShowEdit(false);
    onUpdate?.(updated);
  }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-default-200 bg-default-50 p-6 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
      {/* Header */}
      <div className="flex items-start justify-between space-x-4">
        <div className="flex items-start space-x-4 flex-1 min-w-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-blue-100 to-blue-50 dark:from-blue-900/30 dark:to-blue-800/20">
            <Github className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 space-y-1 min-w-0">
            <p className="text-base font-semibold leading-none truncate">{project.name}</p>
            <p className="text-sm text-default-400 truncate">{project.repo}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip>
            <Tooltip.Trigger>
              <Button isIconOnly variant="ghost" size="sm" className="h-9 w-9 rounded-lg" onPress={() => setShowEdit(true)}>
                <Pencil className="h-4 w-4" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>编辑</Tooltip.Content>
          </Tooltip>
          {confirmDelete ? (
            <>
              <Button size="sm" variant="danger" className="h-9 px-3" onPress={() => onDelete(project.id)}>确认</Button>
              <Button size="sm" variant="outline" className="h-9 px-3" onPress={() => setConfirmDelete(false)}>取消</Button>
            </>
          ) : (
            <Tooltip>
              <Tooltip.Trigger>
                <Button isIconOnly variant="ghost" size="sm" className="h-9 w-9 rounded-lg" onPress={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>删除</Tooltip.Content>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Warning */}
      {!project.ruleset_id && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 shrink-0" />
          <span className="text-xs font-medium text-yellow-800 dark:text-yellow-200">未配置规则集</span>
        </div>
      )}

      {/* Description */}
      {project.description && (
        <p className="mt-4 text-sm text-default-400 line-clamp-2">{project.description}</p>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-default-200 pt-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-lg bg-primary/10 px-3 py-1 text-xs font-semibold text-primary dark:bg-primary/20">
            {project.default_branch}
          </span>
        </div>
        <Button variant="ghost" size="sm" onPress={() => router.push(`/projects/${project.id}`)} className="gap-2">
          审查
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <EditProjectModal project={project} open={showEdit} onClose={() => setShowEdit(false)} onUpdated={handleUpdated} />
    </div>
  );
}
