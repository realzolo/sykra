'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Shield, ChevronRight } from 'lucide-react';
import { Button, Input, Modal, useOverlayState, Chip } from '@heroui/react';
import { toast } from 'sonner';

type RuleSet = { id: string; name: string; description?: string; is_global: boolean; rules?: unknown[] };

export default function RulesClient({ initialRuleSets }: { initialRuleSets: RuleSet[] }) {
  const router = useRouter();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>(initialRuleSets);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const modalState = useOverlayState({ isOpen: showCreate, onOpenChange: (v) => { if (!v) setShowCreate(false); } });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/rules/sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success('规则集已创建');
    setShowCreate(false);
    setName(''); setDescription('');
    const updated = await fetch('/api/rules/sets').then(r => r.json());
    setRuleSets(updated);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">规则集</h1>
            <p className="text-sm text-muted-foreground mt-0.5">配置 AI 代码审查规则</p>
          </div>
          <Button onPress={() => setShowCreate(true)} size="sm" className="gap-1.5">
            <Plus className="size-4" />
            新建规则集
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {ruleSets.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-6 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Shield className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-medium">还没有规则集</h3>
              <p className="text-sm text-muted-foreground mt-0.5">创建规则集来定义 AI 应检查的内容</p>
            </div>
            <Button onPress={() => setShowCreate(true)} size="sm" className="gap-1.5 mt-1">
              <Plus className="size-4" />新建规则集
            </Button>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="flex items-center px-4 py-2 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground gap-4">
              <div className="w-8 shrink-0" />
              <div className="flex-1">名称</div>
              <div className="w-24 text-right">规则数</div>
              <div className="w-6 shrink-0" />
            </div>
            {ruleSets.map(rs => {
              const total = (rs.rules as unknown[])?.length ?? 0;
              const enabled = (rs.rules as { is_enabled: boolean }[])?.filter(r => r.is_enabled).length ?? 0;
              return (
                <div
                  key={rs.id}
                  className="flex items-center gap-4 px-4 py-3.5 border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/rules/${rs.id}`)}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
                    <Shield className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{rs.name}</span>
                      {rs.is_global && <Chip size="sm" variant="soft" color="accent">全局</Chip>}
                    </div>
                    {rs.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{rs.description}</div>
                    )}
                  </div>
                  <div className="w-24 text-right shrink-0">
                    <span className="text-sm font-medium text-success">{enabled}</span>
                    <span className="text-sm text-muted-foreground">/{total}</span>
                    <div className="text-[10px] text-muted-foreground">已启用</div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal state={modalState}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>新建规则集</Modal.Heading>
              </Modal.Header>
              <form onSubmit={handleCreate}>
                <Modal.Body className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">名称</label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="例如：Nuxt SaaS 规则" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">描述 <span className="text-muted-foreground font-normal">（可选）</span></label>
                    <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="这个规则集用于什么？" />
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button type="button" variant="outline" onPress={() => setShowCreate(false)}>取消</Button>
                  <Button type="submit" isDisabled={creating}>{creating ? '创建中…' : '创建'}</Button>
                </Modal.Footer>
              </form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
