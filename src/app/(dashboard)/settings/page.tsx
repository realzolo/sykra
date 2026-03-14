'use client';

import { useState, useEffect } from 'react';
import { Button } from '@heroui/react';
import { Github, Layers, Key, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

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
      <div className="px-8 h-16 flex items-center border-b border-border bg-card shrink-0">
        <div>
          <h2 className="text-lg font-semibold">设置</h2>
          <p className="text-xs text-muted-foreground">环境变量与连接状态</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 bg-muted/30">
        <div className="max-w-2xl flex flex-col gap-4">

          {/* GitHub */}
          <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Github className="size-5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold">GitHub 访问令牌</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    仓库访问 PAT · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">GITHUB_PAT</code>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" isDisabled={ghLoading} onPress={fetchGitHubStatus} className="gap-1.5 shrink-0">
                <RefreshCw className={['size-3.5', ghLoading ? 'animate-spin' : ''].join(' ')} />
                测试连接
              </Button>
            </div>

            {ghLoading ? (
              <div className="flex items-center gap-2 py-2.5">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">正在测试连接…</span>
              </div>
            ) : ghError ? (
              <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <AlertCircle className="size-4 text-destructive shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-destructive">连接失败</div>
                  <div className="text-xs text-destructive/80 mt-0.5">{ghError}</div>
                </div>
              </div>
            ) : ghStatus ? (
              <div className="flex items-center gap-3.5 px-3.5 py-3 rounded-lg bg-green-50 border border-green-200 dark:bg-green-950/20 dark:border-green-900">
                <img src={ghStatus.avatar_url} alt={ghStatus.login} className="w-10 h-10 rounded-full shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{ghStatus.name ?? ghStatus.login}</span>
                    <span className="text-xs text-muted-foreground">@{ghStatus.login}</span>
                    <CheckCircle className="size-4 text-green-600" />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {ghStatus.public_repos} 个公开 · {ghStatus.total_private_repos} 个私有仓库
                  </div>
                </div>
                <a href={ghStatus.html_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary no-underline shrink-0 hover:underline">
                  查看主页 →
                </a>
              </div>
            ) : null}
          </div>

          {/* Anthropic */}
          <div className="bg-card rounded-xl border border-border p-6 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
              <Layers className="size-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold mb-0.5">Claude API 密钥</div>
              <div className="text-xs text-muted-foreground">
                Anthropic AI 分析密钥 · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">ANTHROPIC_API_KEY</code>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-xs font-semibold text-green-700 dark:text-green-400 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 block" />
              已配置
            </div>
          </div>

          {/* Supabase */}
          <div className="bg-card rounded-xl border border-border p-6 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <Key className="size-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold mb-0.5">Supabase</div>
              <div className="text-xs text-muted-foreground">
                数据库与认证 · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">NEXT_PUBLIC_SUPABASE_URL</code>
                {' + '}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">SUPABASE_SERVICE_ROLE_KEY</code>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-xs font-semibold text-green-700 dark:text-green-400 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 block" />
              已配置
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
