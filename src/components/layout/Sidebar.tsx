'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Code2, FolderOpen, FileText, Shield, Settings, LogOut } from 'lucide-react';
import { Button, Chip } from '@heroui/react';
import { createClient } from '@/lib/supabase/client';

const navItems = [
  { href: '/projects', label: '项目', icon: FolderOpen, countKey: 'projects' as const },
  { href: '/reports',  label: '报告',  icon: FileText,   countKey: 'reports' as const },
  { href: '/rules',    label: '规则集', icon: Shield,     countKey: null },
  { href: '/settings', label: '设置',  icon: Settings,   countKey: null },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>({});

  const activeHref = navItems.find(item => pathname.startsWith(item.href))?.href ?? '/projects';

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then(r => r.json()).then((d: unknown[]) => ({ projects: Array.isArray(d) ? d.length : 0 })).catch(() => ({ projects: 0 })),
      fetch('/api/reports').then(r => r.json()).then((d: unknown[]) => ({ reports: Array.isArray(d) ? d.length : 0 })).catch(() => ({ reports: 0 })),
    ]).then(([p, r]) => setCounts({ ...p, ...r }));
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="w-64 h-screen flex flex-col shrink-0 border-r border-border bg-card">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shrink-0 shadow-md">
          <Code2 className="text-white size-4" />
        </div>
        <span className="font-bold text-lg tracking-tight">代码审查</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const active = activeHref === item.href;
          const count = item.countKey ? counts[item.countKey] : null;
          const Icon = item.icon;
          return (
            <Button
              key={item.href}
              variant={active ? 'secondary' : 'ghost'}
              onPress={() => router.push(item.href)}
              className="w-full justify-start gap-3 h-10"
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {count != null && count > 0 && (
                <Chip size="sm" variant={active ? 'primary' : 'secondary'}>{count}</Chip>
              )}
            </Button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border shrink-0">
        <Button variant="ghost" onPress={handleSignOut} className="w-full justify-start gap-3 h-10">
          <LogOut className="size-4" />
          退出登录
        </Button>
      </div>
    </div>
  );
}
