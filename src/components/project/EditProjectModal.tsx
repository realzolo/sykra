'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Select, ListBox, useOverlayState } from '@heroui/react';
import { Button } from '@heroui/react';
import { toast } from 'sonner';

type Project = {
  id: string; name: string; repo: string;
  description?: string; default_branch: string; ruleset_id?: string;
};
type RuleSet = { id: string; name: string };

export default function EditProjectModal({ project, open, onClose, onUpdated }: {
  project: Project;
  open: boolean;
  onClose: () => void;
  onUpdated: (updated: Project) => void;
}) {
  const state = useOverlayState({ isOpen: open, onOpenChange: (v) => { if (!v) onClose(); } });
  const [loading, setLoading] = useState(false);
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [rulesetId, setRulesetId] = useState(project.ruleset_id ?? 'none');

  useEffect(() => {
    if (open) {
      setName(project.name);
      setDescription(project.description ?? '');
      setRulesetId(project.ruleset_id ?? 'none');
      fetch('/api/rules/sets').then(r => r.json()).then(setRuleSets).catch(() => {});
    }
  }, [open, project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, ruleset_id: rulesetId === 'none' ? undefined : rulesetId }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error ?? '更新失败'); return; }
    toast.success('项目已更新');
    onUpdated(data);
  }

  const rulesetItems = [{ id: 'none', name: '无' }, ...ruleSets.map(rs => ({ id: rs.id, name: rs.name }))];

  return (
    <Modal state={state}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>编辑项目</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-semibold">项目名称</label>
                  <Input id="name" value={name} onChange={e => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <label htmlFor="description" className="text-sm font-semibold">描述 <span className="text-default-400 font-normal">（可选）</span></label>
                  <Input id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="这个项目是做什么的？" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">规则集 <span className="text-default-400 font-normal">（可选）</span></label>
                  <Select selectedKey={rulesetId} onSelectionChange={(key) => setRulesetId(key as string)}>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox items={rulesetItems}>
                        {(item) => <ListBox.Item id={item.id}>{item.name}</ListBox.Item>}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
              </form>
            </Modal.Body>
            <Modal.Footer>
              <Button type="button" variant="outline" onPress={onClose}>取消</Button>
              <Button type="submit" variant="primary" isDisabled={loading} onPress={handleSubmit as unknown as () => void}>{loading ? '保存中…' : '保存'}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
