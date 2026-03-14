'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Github, Trash2, Pencil, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button, Chip, Tooltip } from '@heroui/react';
import EditProjectModal from './EditProjectModal';
import type { Dictionary } from '@/i18n';

type Project = {
  id: string; name: string; repo: string;
  description?: string; default_branch: string; ruleset_id?: string;
};

export default function ProjectCard({ project: initialProject, onDelete, onUpdate, dict }: {
  project: Project;
  onDelete: (id: string) => void;
  onUpdate?: (updated: Project) => void;
  dict: Dictionary;
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
    <div className="group flex items-center gap-4 px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
        <Github className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{project.name}</span>
          <Chip size="sm" variant="secondary">{project.default_branch}</Chip>
          {!project.ruleset_id && (
            <Chip size="sm" color="warning" variant="soft">
              <AlertTriangle className="size-3 mr-1" />{dict.projects.noRuleSet}
            </Chip>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{project.repo}</div>
      </div>

      {project.description && (
        <div className="hidden md:block text-xs text-muted-foreground max-w-[200px] truncate">
          {project.description}
        </div>
      )}

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {confirmDelete ? (
          <>
            <Button size="sm" variant="danger" className="h-7 px-2.5 text-xs" onPress={() => onDelete(project.id)}>{dict.projects.confirmDelete}</Button>
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onPress={() => setConfirmDelete(false)}>{dict.common.cancel}</Button>
          </>
        ) : (
          <>
            <Tooltip>
              <Tooltip.Trigger>
                <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowEdit(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>{dict.common.edit}</Tooltip.Content>
            </Tooltip>
            <Tooltip>
              <Tooltip.Trigger>
                <Button isIconOnly variant="ghost" size="sm" onPress={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>{dict.common.delete}</Tooltip.Content>
            </Tooltip>
          </>
        )}
        <Button size="sm" variant="outline" onPress={() => router.push(`/projects/${project.id}`)} className="gap-1.5 h-7 px-2.5 text-xs">
          {dict.projects.review}
          <ExternalLink className="h-3 w-3" />
        </Button>
      </div>

      <EditProjectModal project={project} open={showEdit} onClose={() => setShowEdit(false)} onUpdated={handleUpdated} dict={dict} />
    </div>
  );
}
