# Internationalization (i18n) Implementation Guide

## Overview

This project implements internationalization (i18n) supporting 5 languages:
- **en** - English (default)
- **zh** - 简体中文 (Simplified Chinese)
- **ja** - 日本語 (Japanese)
- **es** - Español (Spanish)
- **zh-TW** - 繁體中文 (Traditional Chinese)

## Architecture

### Directory Structure

```
src/
  i18n/
    config.ts           # i18n configuration
    index.ts            # Dictionary loader and type definitions
    dictionaries/
      en.json           # English translations
      zh.json           # Simplified Chinese translations
      ja.json           # Japanese translations
      es.json           # Spanish translations
      zh-TW.json        # Traditional Chinese translations
  lib/
    locale.ts           # Locale management (cookies)
    i18n-utils.ts       # Utility functions (template replacement, formatting)
  contexts/
    LocaleContext.tsx   # Client-side locale context (optional)
  components/
    common/
      LanguageSwitcher.tsx  # Language switcher component
  app/
    api/
      locale/
        route.ts        # Language switching API
```

### Core Files

#### 1. `src/i18n/config.ts`

Defines supported locales and default language.

```typescript
export const i18n = {
  defaultLocale: 'en',
  locales: ['en', 'zh', 'ja', 'es', 'zh-TW'],
} as const;

export type Locale = (typeof i18n)['locales'][number];
```

#### 2. `src/i18n/index.ts`

Dictionary loader with TypeScript type inference.

```typescript
import type { Locale } from './config';

const dictionaries = {
  en: () => import('./dictionaries/en.json').then((module) => module.default),
  zh: () => import('./dictionaries/zh.json').then((module) => module.default),
  ja: () => import('./dictionaries/ja.json').then((module) => module.default),
  es: () => import('./dictionaries/es.json').then((module) => module.default),
  'zh-TW': () => import('./dictionaries/zh-TW.json').then((module) => module.default),
};

export const getDictionary = async (locale: Locale) => dictionaries[locale]();

export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;
```

#### 3. `src/lib/locale.ts`

Cookie-based locale management for server components.

```typescript
import { cookies } from 'next/headers';
import { i18n, type Locale } from '@/i18n/config';

const COOKIE_NAME = 'NEXT_LOCALE';

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  return (cookieStore.get(COOKIE_NAME)?.value as Locale) || i18n.defaultLocale;
}

export async function setLocale(locale: Locale) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, locale, {
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  });
}
```

#### 4. `src/lib/i18n-utils.ts`

Utility functions for template replacement and formatting.

```typescript
// Template string replacement: "Hello {{name}}" -> "Hello John"
export function t(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

// Date localization
export function getLocalizedDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale).format(date);
}

// Number localization
export function getLocalizedNumber(num: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(num);
}
```

## Usage Patterns

### Server Components

Server components fetch the locale and dictionary, then pass to client components.

```tsx
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export default async function MyPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return (
    <div>
      <h1>{dict.common.title}</h1>
      <MyClient dict={dict} />
    </div>
  );
}
```

### Client Components

Client components receive the dictionary as props.

```tsx
'use client';

import type { Dictionary } from '@/i18n';

interface MyClientProps {
  dict: Dictionary;
}

export default function MyClient({ dict }: MyClientProps) {
  return (
    <div>
      <button>{dict.common.save}</button>
      <button>{dict.common.cancel}</button>
    </div>
  );
}
```

### Template Strings with Variables

Use the `t()` function for dynamic content with placeholders.

```tsx
import { t } from '@/lib/i18n-utils';

// Dictionary: "daysAgo": "{{days}} days ago"
const text = t(dict.projects.daysAgo, { days: '5' });
// Result: "5 days ago"

// Dictionary: "greeting": "Hello {{name}}, you have {{count}} messages"
const greeting = t(dict.common.greeting, { name: 'John', count: '3' });
// Result: "Hello John, you have 3 messages"
```

### Language Switcher Component

The `LanguageSwitcher` component allows users to change language.

```tsx
'use client';

import { useState } from 'react';
import { Select, ListBox } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { i18n, type Locale } from '@/i18n/config';

const languages = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '简体中文' },
  { id: 'ja', label: '日本語' },
  { id: 'es', label: 'Español' },
  { id: 'zh-TW', label: '繁體中文' },
];

export default function LanguageSwitcher({ currentLocale }: { currentLocale: Locale }) {
  const router = useRouter();
  const [locale, setLocale] = useState<Locale>(currentLocale);

  async function handleChange(newLocale: Locale) {
    setLocale(newLocale);
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: newLocale }),
    });
    router.refresh();
  }

  return (
    <Select selectedKey={locale} onSelectionChange={(key) => handleChange(key as Locale)}>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox items={languages}>
          {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
```

## Dictionary Structure

All dictionary files must have the same structure with consistent keys.

```json
{
  "common": {
    "loading": "Loading...",
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    ...
  },
  "nav": {
    "projects": "Projects",
    "reports": "Reports",
    "rules": "Rules",
    "settings": "Settings"
  },
  "projects": {
    "title": "Projects",
    "addProject": "Add Project",
    "editProject": "Edit Project",
    ...
  },
  "reports": {
    "title": "Reports",
    ...
  },
  ...
}
```

### Key Naming Conventions

- Use **camelCase** for keys
- Group related keys under sections (common, nav, projects, etc.)
- Use descriptive names that indicate purpose
- Keep keys **consistent** across all language files
- Use nested structure for better organization

## Adding New Translations

### Step 1: Add Keys to All Dictionary Files

You must add the same key to **all 5 language files**.

**en.json:**
```json
{
  "mySection": {
    "myKey": "My English Text",
    "greeting": "Hello {{name}}"
  }
}
```

**zh.json:**
```json
{
  "mySection": {
    "myKey": "我的中文文本",
    "greeting": "你好 {{name}}"
  }
}
```

**ja.json:**
```json
{
  "mySection": {
    "myKey": "私の日本語テキスト",
    "greeting": "こんにちは {{name}}"
  }
}
```

And so on for es.json and zh-TW.json.

### Step 2: Use in Components

```tsx
// Server component
const dict = await getDictionary(locale);
return <div>{dict.mySection.myKey}</div>;

// Client component
export default function MyClient({ dict }: { dict: Dictionary }) {
  return <div>{dict.mySection.myKey}</div>;
}

// With template variables
import { t } from '@/lib/i18n-utils';
const text = t(dict.mySection.greeting, { name: 'John' });
```

## API Routes

### POST /api/locale

Endpoint for switching user's language preference.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { setLocale } from '@/lib/locale';
import type { Locale } from '@/i18n/config';

export async function POST(request: NextRequest) {
  const { locale } = await request.json();
  await setLocale(locale as Locale);
  return NextResponse.json({ success: true });
}
```

## Type Safety

TypeScript automatically infers dictionary types from `en.json`:

```typescript
// Type is inferred from en.json structure
export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;

// Usage with full autocomplete
function MyComponent({ dict }: { dict: Dictionary }) {
  dict.common.save // ✅ Autocomplete works
  dict.common.invalid // ❌ TypeScript error
}
```

This provides:
- **Autocomplete** for all dictionary keys
- **Type checking** to catch missing keys
- **Refactoring safety** when renaming keys

## Best Practices

1. **Never hardcode user-facing text** - Always use dictionary keys
2. **Keep keys synchronized** - All language files must have identical keys
3. **Use template strings for dynamic content** - Use `{{placeholder}}` syntax
4. **Pass dict as props** - Server components fetch dict, client components receive it
5. **Group related keys** - Organize by feature/section
6. **Use descriptive key names** - Make keys self-documenting
7. **Test all languages** - Verify translations display correctly
8. **Avoid nested components** - Pass dict down through props, don't re-fetch

## Common Patterns

### Conditional Text

```tsx
<span>{isActive ? dict.common.active : dict.common.inactive}</span>
```

### Lists with Counts

```tsx
// Dictionary: "itemsCount": "{{count}} items"
<span>{t(dict.common.itemsCount, { count: items.length.toString() })}</span>
```

### Date Formatting

```tsx
import { getLocalizedDate } from '@/lib/i18n-utils';

const formattedDate = getLocalizedDate(new Date(), locale);
// en: "3/15/2026"
// zh: "2026/3/15"
// ja: "2026/3/15"
```

### Number Formatting

```tsx
import { getLocalizedNumber } from '@/lib/i18n-utils';

const formattedNumber = getLocalizedNumber(1234.56, locale);
// en: "1,234.56"
// zh: "1,234.56"
// ja: "1,234.56"
```

### Status Badges

```tsx
// Dictionary has nested status object
<Chip>{dict.reports.status[report.status]}</Chip>
```

## Troubleshooting

### TypeScript Errors After Adding Keys

If you get type errors after adding new keys:

1. Clear `.next` directory: `rm -rf .next`
2. Rebuild: `pnpm build`
3. Restart TypeScript server in your IDE

### Missing Translations

If a key is missing in some languages:

1. Check all 5 dictionary files have the same keys
2. Use a diff tool to compare files
3. Run `pnpm build` to catch type errors

### Language Not Switching

1. **Check cookie**: Inspect browser cookies for `NEXT_LOCALE`
2. **Verify API**: Check network tab for `/api/locale` request
3. **Ensure refresh**: Make sure `router.refresh()` is called after setting locale

### Build Fails with Type Errors

If build fails with "Two different types with this name exist":

1. One or more dictionary files have different keys
2. Compare all dictionary files to find missing keys
3. Add missing keys to all files
4. Clear `.next` and rebuild

## Migration Guide

To migrate existing hardcoded text to i18n:

### Step 1: Identify Hardcoded Text

Find all hardcoded strings in your component:

```tsx
// Before
<button>保存</button>
<h1>项目列表</h1>
```

### Step 2: Add Translation Keys

Add keys to all 5 dictionary files:

```json
// en.json
{
  "common": { "save": "Save" },
  "projects": { "title": "Projects" }
}

// zh.json
{
  "common": { "save": "保存" },
  "projects": { "title": "项目列表" }
}
```

### Step 3: Update Page Component

Fetch locale and dictionary:

```tsx
// page.tsx
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import MyClient from './MyClient';

export default async function Page() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <MyClient dict={dict} />;
}
```

### Step 4: Update Client Component

Add dict prop and use dictionary keys:

```tsx
// MyClient.tsx
'use client';
import type { Dictionary } from '@/i18n';

export default function MyClient({ dict }: { dict: Dictionary }) {
  return (
    <div>
      <h1>{dict.projects.title}</h1>
      <button>{dict.common.save}</button>
    </div>
  );
}
```

### Step 5: Test All Languages

1. Switch language using LanguageSwitcher
2. Verify all text displays correctly
3. Check for missing translations

## Performance Considerations

- **On-demand loading**: Dictionaries are loaded per route
- **Next.js caching**: Dictionary imports are cached automatically
- **Fast locale detection**: Cookie-based, no database queries
- **No client JS for static text**: Server-rendered translations
- **Small bundle size**: Only one dictionary loaded per request

## Future Enhancements

- [ ] Add more languages (French, German, etc.)
- [ ] Implement lazy loading for large dictionaries
- [ ] Add translation management UI
- [ ] Integrate with translation services (Crowdin, Lokalise)
- [ ] Add RTL language support (Arabic, Hebrew)
- [ ] Implement pluralization rules
- [ ] Add context-aware translations
- [ ] Support for markdown in translations

## Resources

- [Next.js i18n Documentation](https://nextjs.org/docs/app/building-your-application/routing/internationalization)
- [Intl API Documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
- [Unicode CLDR](https://cldr.unicode.org/) - Locale data standards
