'use client';

import { Settings, GitBranch, BarChart3 } from 'lucide-react';
import { Tabs } from '@heroui/react';
import CommitsClient from './CommitsClient';
import ProjectConfigPanel from '@/components/project/ProjectConfigPanel';
import DashboardStats from '@/components/dashboard/DashboardStats';
import type { Dictionary } from '@/i18n';

type Project = {
  id: string; name: string; repo: string; default_branch: string;
};

export default function EnhancedProjectDetail({ project, branches, dict }: { project: Project; branches: string[]; dict: Dictionary }) {
  return (
    <div className="flex flex-col h-full">
      <Tabs className="flex flex-col h-full" defaultSelectedKey="commits">
        <Tabs.ListContainer className="border-b border-border bg-background shrink-0 px-4">
          <Tabs.List>
            <Tabs.Tab id="commits">
              <GitBranch className="size-4 mr-2" />
              {dict.commits.title}
            </Tabs.Tab>
            <Tabs.Tab id="stats">
              <BarChart3 className="size-4 mr-2" />
              {dict.projects.statistics}
            </Tabs.Tab>
            <Tabs.Tab id="config">
              <Settings className="size-4 mr-2" />
              {dict.projects.projectConfig}
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <div className="flex-1 overflow-auto">
          <Tabs.Panel id="commits">
            <CommitsClient project={project} branches={branches} dict={dict} />
          </Tabs.Panel>
          <Tabs.Panel id="stats" className="p-8 space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-1">{dict.projects.projectStatistics}</h2>
              <p className="text-sm text-muted-foreground">{dict.projects.viewQualityTrends.replace('{{name}}', project.name)}</p>
            </div>
            <DashboardStats projectId={project.id} dict={dict} />
          </Tabs.Panel>
          <Tabs.Panel id="config" className="p-8">
            <ProjectConfigPanel projectId={project.id} dict={dict} />
          </Tabs.Panel>
        </div>
      </Tabs>
    </div>
  );
}
