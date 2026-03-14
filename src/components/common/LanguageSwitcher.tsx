'use client';

import { Select, ListBox } from '@heroui/react';
import { Languages } from 'lucide-react';
import { locales, localeNames, type Locale } from '@/i18n/config';
import { useRouter } from 'next/navigation';

interface LanguageSwitcherProps {
  currentLocale: Locale;
}

export function LanguageSwitcher({ currentLocale }: LanguageSwitcherProps) {
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
    <Select
      selectedKey={currentLocale}
      onSelectionChange={(key) => handleLocaleChange(key as string)}
      className="w-40"
    >
      <Select.Trigger className="h-8 text-xs">
        <div className="flex items-center gap-1.5">
          <Languages className="size-3.5" />
          <Select.Value>{localeNames[currentLocale]}</Select.Value>
        </div>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox items={items}>
          {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
