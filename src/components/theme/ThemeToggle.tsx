'use client';

import { Moon, Sun } from 'lucide-react';
import { Button } from '@heroui/react';
import { useTheme } from './ThemeProvider';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <Button
      size="sm"
      variant="ghost"
      isIconOnly
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      onPress={toggle}
      className="h-8 w-8"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
