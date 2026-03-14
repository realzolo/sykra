'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Code2 } from 'lucide-react';
import { Input, Button } from '@heroui/react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    router.push('/projects');
    router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-13 h-13 rounded-2xl mb-4 bg-primary/10 text-primary ring-1 ring-primary/20" style={{ width: 52, height: 52 }}>
          <Code2 className="size-6" />
        </div>
        <div className="text-xl font-semibold text-foreground mb-1.5">代码审查平台</div>
        <div className="text-sm text-muted-foreground">登录您的账户</div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-foreground text-sm font-medium">邮箱</label>
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-foreground text-sm font-medium">密码</label>
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          isDisabled={loading}
          className="w-full h-10 font-semibold mt-1"
        >
          {loading ? '登录中…' : '登录'}
        </Button>
      </form>

      <div className="text-center mt-5 text-xs text-muted-foreground">内部工具 — 如需访问请联系管理员</div>
    </div>
  );
}
