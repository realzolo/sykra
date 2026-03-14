'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Loader2 } from 'lucide-react';
import { Input, TextArea, Switch, Button } from '@heroui/react';
import { toast } from 'sonner';

type ProjectConfig = {
  ignore_patterns: string[];
  quality_threshold: number | null;
  auto_analyze: boolean;
  webhook_url: string | null;
};

export default function ProjectConfigPanel({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<ProjectConfig>({
    ignore_patterns: [],
    quality_threshold: null,
    auto_analyze: false,
    webhook_url: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ignoreText, setIgnoreText] = useState('');

  useEffect(() => {
    fetch(`/api/projects/${projectId}/config`)
      .then(r => r.json())
      .then(data => {
        setConfig(data);
        setIgnoreText((data.ignore_patterns || []).join('\n'));
        setLoading(false);
      })
      .catch(() => {
        toast.error('加载配置失败');
        setLoading(false);
      });
  }, [projectId]);

  async function handleSave() {
    setSaving(true);

    const ignorePatterns = ignoreText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    const res = await fetch(`/api/projects/${projectId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ignorePatterns,
        qualityThreshold: config.quality_threshold,
        autoAnalyze: config.auto_analyze,
        webhookUrl: config.webhook_url,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? '保存失败');
      return;
    }

    toast.success('配置已保存');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="size-5" />
        <h3 className="text-lg font-semibold">项目配置</h3>
      </div>

      {/* Ignore Patterns */}
      <div className="space-y-2">
        <label htmlFor="ignore-patterns" className="text-sm font-medium">忽略文件模式</label>
        <TextArea
          id="ignore-patterns"
          value={ignoreText}
          onChange={e => setIgnoreText(e.target.value)}
          placeholder={"每行一个模式，例如：\nnode_modules/**\n*.test.ts\ndist/**"}
          rows={8}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          使用 .gitignore 风格的模式，每行一个。以 # 开头的行为注释。
        </p>
      </div>

      {/* Quality Threshold */}
      <div className="space-y-2">
        <label htmlFor="quality-threshold" className="text-sm font-medium">质量阈值</label>
        <Input
          id="quality-threshold"
          type="number"
          min="0"
          max="100"
          value={String(config.quality_threshold ?? '')}
          onChange={e =>
            setConfig(prev => ({
              ...prev,
              quality_threshold: e.target.value ? parseInt(e.target.value) : null,
            }))
          }
          placeholder="例如: 80"
        />
        <p className="text-xs text-muted-foreground">
          低于此分数时将发出警告。留空表示不设置阈值。
        </p>
      </div>

      {/* Auto Analyze */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <label className="text-sm font-medium">自动分析</label>
          <p className="text-xs text-muted-foreground">
            当检测到新提交时自动触发代码审查
          </p>
        </div>
        <Switch
          isSelected={config.auto_analyze}
          onChange={(v) => setConfig(prev => ({ ...prev, auto_analyze: v }))}
        />
      </div>

      {/* Webhook URL */}
      <div className="space-y-2">
        <label htmlFor="webhook-url" className="text-sm font-medium">Webhook URL</label>
        <Input
          id="webhook-url"
          type="url"
          value={config.webhook_url ?? ''}
          onChange={e =>
            setConfig(prev => ({ ...prev, webhook_url: e.target.value || null }))
          }
          placeholder="https://your-webhook-url.com/notify"
        />
        <p className="text-xs text-muted-foreground">
          分析完成后将向此 URL 发送 POST 请求通知。
        </p>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4">
        <Button onPress={handleSave} isDisabled={saving} className="gap-2">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? '保存中…' : '保存配置'}
        </Button>
      </div>
    </div>
  );
}
