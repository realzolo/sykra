'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Github, Trash2, Pencil, ExternalLink, AlertTriangle, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import EditProjectModal from './EditProjectModal';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';

type Project = {
  id: string; name: string; repo: string;
  description?: string; default_branch: string; ruleset_id?: string;
};

export default function ProjectCard({ project: initialProject, onDelete, onUpdate, dict, view = 'grid', canManage = true }: {
  project: Project;
  onDelete: (id: string) => void;
  onUpdate?: (updated: Project) => void;
  dict: Dictionary;
  view?: 'grid' | 'list';
  canManage?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [project, setProject] = useState<Project>(initialProject);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleUpdated(updated: Project) {
    setProject(updated);
    setShowEdit(false);
    onUpdate?.(updated);
  }

  return (
    <TooltipProvider>
      {view === 'list' ? (
        <div className="group flex items-center gap-4 px-4 py-2.5 hover:bg-[hsl(var(--ds-surface-1))] transition-soft">
          <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-muted shrink-0">
            <Github className="h-4 w-4 text-[hsl(var(--ds-text-2))]" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{project.name}</span>
              <Badge variant="muted" size="sm">{project.default_branch}</Badge>
              {!project.ruleset_id && (
                <Badge variant="warning" size="sm" className="gap-1">
                  <AlertTriangle className="size-3" />{dict.projects.noRuleSet}
                </Badge>
              )}
            </div>
            <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">{project.repo}</div>
          </div>

          {project.description && (
            <div className="hidden md:block text-[12px] text-[hsl(var(--ds-text-2))] max-w-[200px] truncate">
              {project.description}
            </div>
          )}

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-soft shrink-0">
            {canManage && (confirmDelete ? (
              <>
                <Button size="sm" variant="destructive" className="h-7 px-2.5 text-xs" onClick={() => onDelete(project.id)}>{dict.projects.confirmDelete}</Button>
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => setConfirmDelete(false)}>{dict.common.cancel}</Button>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={() => setShowEdit(true)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{dict.common.edit}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{dict.common.delete}</TooltipContent>
                </Tooltip>
              </>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(withOrgPrefix(pathname, `/projects/${project.id}/commits`))}
              className="gap-1.5 h-7 px-2.5 text-xs"
            >
              {dict.projects.review}
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>

          {canManage && (
            <EditProjectModal project={project} open={showEdit} onClose={() => setShowEdit(false)} onUpdated={handleUpdated} dict={dict} />
          )}
        </div>
      ) : (
        <div className="group rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 hover:border-foreground/20 transition-soft ">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-muted">
                <Github className="h-4 w-4 text-[hsl(var(--ds-text-2))]" />
              </div>
              <div>
                <div className="text-sm font-medium">{project.name}</div>
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{project.repo}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Badge variant="muted" size="sm">{project.default_branch}</Badge>
              <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-soft">
                <MoreHorizontal className="h-3.5 w-3.5 text-[hsl(var(--ds-text-2))]" />
              </Button>
            </div>
          </div>

          {project.description && (
            <div className="text-[13px] text-[hsl(var(--ds-text-2))] mt-3 line-clamp-2">
              {project.description}
            </div>
          )}

          <div className="flex items-center justify-between mt-4">
            {!project.ruleset_id ? (
              <Badge variant="warning" size="sm" className="gap-1">
                <AlertTriangle className="size-3" />{dict.projects.noRuleSet}
              </Badge>
            ) : (
              <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.projects.ruleSetAttached}</span>
            )}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-soft">
              {canManage && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="ghost" onClick={() => setShowEdit(true)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{dict.common.edit}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(true)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{dict.common.delete}</TooltipContent>
                  </Tooltip>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push(withOrgPrefix(pathname, `/projects/${project.id}/commits`))}
                className="gap-1.5 h-7 px-2.5 text-xs"
              >
                {dict.projects.review}
                <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {canManage && confirmDelete && (
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="destructive" className="h-7 px-2.5 text-xs" onClick={() => onDelete(project.id)}>{dict.projects.confirmDelete}</Button>
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => setConfirmDelete(false)}>{dict.common.cancel}</Button>
            </div>
          )}

          {canManage && (
            <EditProjectModal project={project} open={showEdit} onClose={() => setShowEdit(false)} onUpdated={handleUpdated} dict={dict} />
          )}
        </div>
      )}
    </TooltipProvider>
  );
}
