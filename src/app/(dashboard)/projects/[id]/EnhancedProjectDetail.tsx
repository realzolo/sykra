'use client';

import { Settings, GitBranch, BarChart3 } from 'lucide-react';
import { Tabs } from '@heroui/react';
import CommitsClient from './CommitsClient';
import ProjectConfigPanel from '@/components/project/ProjectConfigPanel';
import DashboardStats from '@/components/dashboard/DashboardStats';

type Project = {
  id: string; name: string; repo: string; default_branch: string;
};

export default function EnhancedProjectDetail({ project, branches }: { project: Project; branches: string[] }) {
  return (
    <div className="flex flex-col h-full">
      <Tabs className="flex flex-col h-full" defaultSelectedKey="commits">
        <Tabs.ListContainer className="border-b border-border bg-background shrink-0 px-4">
          <Tabs.List>
            <Tabs.Tab id="commits">
              <GitBranch className="size-4 mr-2" />
              提交记录
            </Tabs.Tab>
            <Tabs.Tab id="stats">
              <BarChart3 className="size-4 mr-2" />
              统计分析
            </Tabs.Tab>
            <Tabs.Tab id="config">
              <Settings className="size-4 mr-2" />
              项目配置
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <div className="flex-1 overflow-auto">
          <Tabs.Panel id="commits">
            <CommitsClient project={project} branches={branches} />
          </Tabs.Panel>
          <Tabs.Panel id="stats" className="p-8 space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-1">项目统计</h2>
              <p className="text-sm text-muted-foreground">查看 {project.name} 的质量趋势和统计数据</p>
            </div>
            <DashboardStats projectId={project.id} />
          </Tabs.Panel>
          <Tabs.Panel id="config" className="p-8">
            <ProjectConfigPanel projectId={project.id} />
          </Tabs.Panel>
        </div>
      </Tabs>
    </div>
  );
}
