'use client';

import { useState, useEffect } from 'react';
import { useProject } from '@/lib/projectContext';
import CodebaseClient from '@/app/(dashboard)/projects/[id]/CodebaseClient';
import type { Dictionary } from '@/i18n';

export default function ProjectCodebaseView({ projectId, dict }: { projectId: string; dict: Dictionary }) {
  const { project } = useProject();
  const [branches, setBranches] = useState<string[]>([]);

  useEffect(() => {
    let canceled = false;
    fetch(`/api/projects/${projectId}/branches?sync=0`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('branches_fetch_failed');
        }
        return response.json();
      })
      .then((data) => {
        if (canceled) return;
        const next = Array.isArray(data) ? data : [];
        setBranches((prev) => (sameStringArray(prev, next) ? prev : next));
      })
      .catch(() => {
        if (canceled) return;
        setBranches((prev) => (prev.length ? [] : prev));
      });
    return () => {
      canceled = true;
    };
  }, [projectId]);

  if (!project) return null;

  return <CodebaseClient project={project} branches={branches} dict={dict} />;
}

function sameStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
