'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Languages } from 'lucide-react';
import { locales, localeNames, type Locale } from '@/i18n/config';
import { useRouter } from 'next/navigation';

interface LanguageSwitcherProps {
  currentLocale: Locale;
  compact?: boolean;
}

export function LanguageSwitcher({ currentLocale, compact = false }: LanguageSwitcherProps) {
  const router = useRouter();

  const handleLocaleChange = async (key: string) => {
    const newLocale = key as Locale;

    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: newLocale }),
    });

    router.refresh();
  };

  const items = locales.map((locale) => ({
    id: locale,
    label: localeNames[locale],
  }));

  return (
    <Select value={currentLocale} onValueChange={(value) => handleLocaleChange(value)}>
      <SelectTrigger className={compact ? 'h-8 w-9 px-0 justify-center' : 'h-8 w-40 text-xs'}>
        {compact ? (
          <>
            <Languages className="size-3.5" />
            <span className="sr-only">{localeNames[currentLocale]}</span>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <Languages className="size-3.5" />
            <SelectValue />
          </div>
        )}
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
