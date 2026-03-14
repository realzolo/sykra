'use client';

import { useState, useEffect } from 'react';
import { Save, Trash2, Star } from 'lucide-react';
import { Input, Modal, useOverlayState } from '@heroui/react';
import { Button } from '@heroui/react';
import { toast } from 'sonner';

type SavedFilter = {
  id: string; name: string;
  filter_config: Record<string, unknown>;
  is_default: boolean; created_at: string;
};

type FilterConfig = {
  severity?: string; category?: string; status?: string; priority?: number;
};

export default function SavedFilters({ userId, currentFilter, onApplyFilter }: {
  userId: string;
  currentFilter: FilterConfig;
  onApplyFilter: (filter: FilterConfig) => void;
}) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [filterName, setFilterName] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogState = useOverlayState();

  useEffect(() => { loadFilters(); }, [userId]);

  async function loadFilters() {
    const res = await fetch(`/api/filters?userId=${userId}`);
    if (res.ok) setFilters(await res.json());
  }

  async function handleSave() {
    if (!filterName.trim()) { toast.error('请输入筛选器名称'); return; }

    setSaving(true);
    const res = await fetch('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name: filterName.trim(), filterConfig: currentFilter, isDefault: false }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? '保存失败');
      return;
    }

    toast.success('筛选器已保存');
    dialogState.close();
    setFilterName('');
    loadFilters();
  }

  async function handleDelete(filterId: string) {
    const res = await fetch(`/api/filters?filterId=${filterId}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('删除失败'); return; }
    toast.success('筛选器已删除');
    loadFilters();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">保存的筛选器</h4>
        <Button variant="outline" size="sm" onPress={dialogState.open} className="gap-2">
          <Save className="size-3.5" />
          保存当前筛选
        </Button>
      </div>

      {filters.length === 0 ? (
        <div className="text-sm text-default-400 text-center py-4">暂无保存的筛选器</div>
      ) : (
        <div className="space-y-2">
          {filters.map(filter => (
            <div key={filter.id} className="flex items-center gap-2 p-2 rounded-md border hover:bg-default-100 transition-colors">
              {filter.is_default && <Star className="size-3.5 text-yellow-500 fill-yellow-500" />}
              <button onClick={() => onApplyFilter(filter.filter_config)} className="flex-1 text-left text-sm">
                {filter.name}
              </button>
              <Button isIconOnly variant="ghost" size="sm" className="h-6 w-6" onPress={() => handleDelete(filter.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal state={dialogState}>
        <Modal.Backdrop isDismissable>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>保存筛选器</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">筛选器名称</label>
                    <Input value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="例如: 严重安全问题" autoFocus />
                  </div>
                  <div className="text-sm text-default-400">
                    当前筛选条件:
                    <ul className="mt-2 space-y-1">
                      {currentFilter.severity && <li>• 严重程度: {currentFilter.severity}</li>}
                      {currentFilter.category && <li>• 分类: {currentFilter.category}</li>}
                      {currentFilter.status && <li>• 状态: {currentFilter.status}</li>}
                      {currentFilter.priority && <li>• 优先级: P{currentFilter.priority}</li>}
                    </ul>
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="outline" onPress={dialogState.close}>取消</Button>
                <Button variant="primary" isDisabled={saving} onPress={handleSave}>{saving ? '保存中…' : '保存'}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
