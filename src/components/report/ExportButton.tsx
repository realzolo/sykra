'use client';

import { useState } from 'react';
import { Download, FileText, FileJson, FileSpreadsheet } from 'lucide-react';
import { Select, ListBox } from '@heroui/react';
import { Button } from '@heroui/react';
import { toast } from 'sonner';

const FORMAT_ITEMS = [
  { id: 'json', label: 'JSON', icon: FileJson },
  { id: 'markdown', label: 'Markdown', icon: FileText },
  { id: 'csv', label: 'CSV', icon: FileSpreadsheet },
];

export default function ExportButton({ reportId }: { reportId: string }) {
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState('json');

  async function handleExport() {
    setExporting(true);

    try {
      const res = await fetch(`/api/reports/${reportId}/export?format=${format}`);

      if (!res.ok) {
        toast.error('导出失败');
        setExporting(false);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const ext = format === 'markdown' ? 'md' : format === 'csv' ? 'csv' : 'json';
      a.download = `report-${reportId.slice(0, 8)}.${ext}`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('报告已导出');
    } catch (err) {
      const message = err instanceof Error ? err.message : '导出失败';
      toast.error(message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select selectedKey={format} onSelectionChange={(key) => setFormat(key as string)} className="w-[140px]">
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox items={FORMAT_ITEMS}>
            {(item) => (
              <ListBox.Item id={item.id}>
                <div className="flex items-center gap-2">
                  <item.icon className="size-4" />
                  {item.label}
                </div>
              </ListBox.Item>
            )}
          </ListBox>
        </Select.Popover>
      </Select>
      <Button variant="outline" size="sm" onPress={handleExport} isDisabled={exporting} className="gap-2">
        <Download className="size-4" />
        导出
      </Button>
    </div>
  );
}
