'use client';

import { useState } from 'react';
import { CheckSquare, Square, Trash2 } from 'lucide-react';
import { Select, ListBox } from '@heroui/react';
import { Button } from '@heroui/react';
import { toast } from 'sonner';

type Issue = {
  file: string; line?: number; severity: string;
  category: string; rule: string; message: string;
};

const STATUS_ITEMS = [
  { id: 'open', label: '待处理' },
  { id: 'fixed', label: '已修复' },
  { id: 'ignored', label: '已忽略' },
  { id: 'false_positive', label: '误报' },
  { id: 'planned', label: '计划修复' },
];

const ASSIGN_ITEMS = [
  { id: 'developer1', label: '开发者1' },
  { id: 'developer2', label: '开发者2' },
  { id: 'developer3', label: '开发者3' },
];

export default function BatchOperations({
  reportId, issues, selectedIds, onSelectionChange, onOperationComplete,
}: {
  reportId: string;
  issues: Issue[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onOperationComplete: () => void;
}) {
  const [operating, setOperating] = useState(false);

  const allSelected = issues.length > 0 && selectedIds.size === issues.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < issues.length;

  function toggleSelectAll() {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(issues.map((_, idx) => idx.toString())));
    }
  }

  async function handleBatchOperation(action: string, value?: string) {
    if (selectedIds.size === 0) { toast.error('请先选择问题'); return; }

    setOperating(true);

    const body: Record<string, unknown> = { action, issueIds: Array.from(selectedIds) };
    if (action === 'update_status' && value) body.status = value;
    else if (action === 'assign' && value) body.assigned_to = value;

    const res = await fetch(`/api/reports/${reportId}/issues/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    setOperating(false);

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? '操作失败');
      return;
    }

    const data = await res.json();
    toast.success(`已处理 ${data.affected} 个问题`);
    onSelectionChange(new Set());
    onOperationComplete();
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-default-100 rounded-lg border border-default-200">
      <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
        {allSelected ? <CheckSquare className="size-4" /> : someSelected ? <Square className="size-4 fill-primary/20" /> : <Square className="size-4" />}
        <span>{selectedIds.size > 0 ? `已选 ${selectedIds.size}` : '全选'}</span>
      </button>

      {selectedIds.size > 0 && (
        <>
          <div className="h-4 w-px bg-default-200" />

          <Select onSelectionChange={(key) => handleBatchOperation('update_status', key as string)} isDisabled={operating} className="w-[140px]">
            <Select.Trigger><Select.Value>更新状态</Select.Value><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox items={STATUS_ITEMS}>
                {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
              </ListBox>
            </Select.Popover>
          </Select>

          <Select onSelectionChange={(key) => handleBatchOperation('assign', key as string)} isDisabled={operating} className="w-[140px]">
            <Select.Trigger><Select.Value>分配给</Select.Value><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox items={ASSIGN_ITEMS}>
                {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
              </ListBox>
            </Select.Popover>
          </Select>

          <Button variant="danger" size="sm" onPress={() => handleBatchOperation('delete')} isDisabled={operating} className="gap-2">
            <Trash2 className="size-3.5" />
            删除
          </Button>

          <Button variant="ghost" size="sm" onPress={() => onSelectionChange(new Set())} isDisabled={operating}>
            取消选择
          </Button>
        </>
      )}
    </div>
  );
}

export function IssueCheckbox({ id, checked, onChange }: { id: string; checked: boolean; onChange: (id: string) => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onChange(id); }} className="shrink-0">
      {checked ? <CheckSquare className="size-4 text-primary" /> : <Square className="size-4 text-default-400 hover:text-primary transition-colors" />}
    </button>
  );
}
