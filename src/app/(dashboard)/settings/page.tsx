'use client';

import { useState, useEffect } from 'react';
import { Button, Chip, Spinner } from '@heroui/react';
import { Github, Layers, Key, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

type GitHubStatus = {
  login: string; name: string | null; avatar_url: string;
  public_repos: number; total_private_repos: number; html_url: string;
};

export default function SettingsPage() {
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [ghLoading, setGhLoading] = useState(true);
  const [ghError, setGhError] = useState('');

  async function fetchGitHubStatus() {
    setGhLoading(true); setGhError('');
    try {
      const res = await fetch('/api/github/status');
      const data = await res.json();
      if (!res.ok) { setGhError(data.error ?? '连接失败'); setGhStatus(null); }
      else { setGhStatus(data); }
    } catch { setGhError('网络错误'); }
    finally { setGhLoading(false); }
  }

  useEffect(() => { fetchGitHubStatus(); }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-4 max-w-[1200px] mx-auto w-full">
          <h1 className="text-xl font-semibold">设置</h1>
          <p className="text-sm text-muted-foreground mt-0.5">环境变量与服务连接状态</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-4">
        {/* GitHub */}
        <div className="border border-border rounded-lg bg-card">
          <div className="flex items-start gap-4 px-6 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0 mt-0.5">
              <Github className="size-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div>
                  <div className="text-sm font-medium">GitHub 访问令牌</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    仓库访问 PAT · 环境变量 <code className="bg-muted px-1 py-0.5 rounded text-xs">GITHUB_PAT</code>
                  </div>
                </div>
                <Button variant="outline" size="sm" isDisabled={ghLoading} onPress={fetchGitHubStatus} className="gap-1.5 shrink-0">
                  <RefreshCw className={['size-3.5', ghLoading ? 'animate-spin' : ''].join(' ')} />
                  测试连接
                </Button>
              </div>

              <div className="mt-3">
                {ghLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner size="sm" />
                    正在测试连接…
                  </div>
                ) : ghError ? (
                  <div className="flex items-start gap-2.5 p-3 rounded-md border border-danger/20 bg-danger/5">
                    <AlertCircle className="size-4 text-danger shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-danger">连接失败</div>
                      <div className="text-xs text-danger/80 mt-0.5">{ghError}</div>
                    </div>
                  </div>
                ) : ghStatus ? (
                  <div className="flex items-center gap-3 p-3 rounded-md border border-success/20 bg-success/5">
                    <img src={ghStatus.avatar_url} alt={ghStatus.login} className="w-8 h-8 rounded-full shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{ghStatus.name ?? ghStatus.login}</span>
                        <span className="text-xs text-muted-foreground">@{ghStatus.login}</span>
                        <CheckCircle className="size-3.5 text-success" />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {ghStatus.public_repos} 个公开 · {ghStatus.total_private_repos} 个私有仓库
                      </div>
                    </div>
                    <a href={ghStatus.html_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline shrink-0">
                      查看主页 →
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Anthropic */}
        <div className="border border-border rounded-lg bg-card">
          <div className="flex items-center gap-4 px-6 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
              <Layers className="size-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Claude API 密钥</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Anthropic AI 分析 · 环境变量 <code className="bg-muted px-1 py-0.5 rounded text-xs">ANTHROPIC_API_KEY</code>
              </div>
            </div>
            <Chip color="success" variant="soft" size="sm">已配置</Chip>
          </div>
        </div>

        {/* Supabase */}
        <div className="border border-border rounded-lg bg-card">
          <div className="flex items-center gap-4 px-6 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
              <Key className="size-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Supabase</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                数据库与认证 ·{' '}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">NEXT_PUBLIC_SUPABASE_URL</code>
                {' '}+{' '}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">SUPABASE_SERVICE_ROLE_KEY</code>
              </div>
            </div>
            <Chip color="success" variant="soft" size="sm">已配置</Chip>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
