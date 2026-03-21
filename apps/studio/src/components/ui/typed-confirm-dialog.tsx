'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SettingsField from '@/components/settings/SettingsField';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type TypedConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  keyword: string;
  keywordHint: string;
  inputLabel: string;
  inputPlaceholder: string;
  mismatchText: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading?: boolean;
  danger?: boolean;
};

export default function TypedConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  keyword,
  keywordHint,
  inputLabel,
  inputPlaceholder,
  mismatchText,
  onOpenChange,
  onConfirm,
  loading = false,
  danger = false,
}: TypedConfirmDialogProps) {
  const [value, setValue] = useState('');

  const matches = value === keyword;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setValue('');
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader className="gap-2">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <DialogBody className="space-y-5">
          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3.5 py-3.5">
            <div className="text-[12px] font-medium leading-5 text-foreground">{keywordHint}</div>
          </div>

          <SettingsField label={inputLabel}>
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={inputPlaceholder}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {value.length > 0 && !matches ? (
              <div className="text-[12px] leading-5 text-danger">{mismatchText}</div>
            ) : null}
          </SettingsField>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading || !matches}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
