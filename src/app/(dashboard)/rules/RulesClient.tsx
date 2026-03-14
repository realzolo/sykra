'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Shield, ChevronRight } from 'lucide-react';
import { Button, Input, Modal, useOverlayState } from '@heroui/react';
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
      <div className="flex items-center justify-between px-8 h-16 border-b border-border bg-card shrink-0">
        <div>
          <h2 className="text-lg font-semibold">规则集</h2>
          <p className="text-xs text-muted-foreground">为每个项目配置审查规则</p>
        </div>
        <Button size="sm" onPress={() => setShowCreate(true)} className="gap-1.5">
          <Plus className="size-4" />
          新建规则集
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 bg-muted/30">
        {ruleSets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-14 h-14 rounded-2xl bg-card border border-border flex items-center justify-center shadow-sm">
              <Shield className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">暂无规则集</p>
            <p className="text-sm text-muted-foreground">创建第一个规则集开始使用</p>
            <Button size="sm" onPress={() => setShowCreate(true)} className="mt-1 gap-1.5">
              <Plus className="size-4" />
              新建规则集
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {ruleSets.map(rs => {
              const total = (rs.rules as unknown[])?.length ?? 0;
              const enabled = (rs.rules as { is_enabled: boolean }[])?.filter(r => r.is_enabled).length ?? 0;
              return (
                <div
                  key={rs.id}
                  onClick={() => router.push(`/rules/${rs.id}`)}
                  className="flex items-center gap-4 px-5 py-4 rounded-xl cursor-pointer border border-border bg-card shadow-sm transition-all hover:shadow-md hover:-translate-y-px"
                >
                  <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center bg-primary/10">
                    <Shield className="size-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold">{rs.name}</span>
                      {rs.is_global && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">全局</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {total} 条规则 · <span className="text-green-600 font-semibold">{enabled} 条已启用</span>
                    </div>
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
                  <Button type="submit" isDisabled={creating}>
                    {creating ? '创建中…' : '创建'}
                  </Button>
                </Modal.Footer>
              </form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
