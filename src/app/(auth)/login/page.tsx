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
    <div className="w-[400px] rounded-2xl p-10 border border-white/10" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-13 h-13 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg, #4f6ef7 0%, #7c3aed 100%)', boxShadow: '0 8px 24px rgba(79,110,247,0.4)', width: 52, height: 52 }}>
          <Code2 className="text-white size-6" />
        </div>
        <div className="text-xl font-bold text-white mb-1.5">代码审查平台</div>
        <div className="text-sm text-white/40">登录您的账户</div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-white/70 text-sm font-semibold">邮箱</label>
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="bg-white/10 text-white border-white/20 placeholder:text-white/30"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-white/70 text-sm font-semibold">密码</label>
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="bg-white/10 text-white border-white/20 placeholder:text-white/30"
          />
        </div>
        <Button
          type="submit"
          isDisabled={loading}
          className="w-full h-10 font-semibold border-none mt-1"
          style={{ background: 'linear-gradient(135deg, #4f6ef7 0%, #7c3aed 100%)', boxShadow: '0 4px 16px rgba(79,110,247,0.35)' }}
        >
          {loading ? '登录中…' : '登录'}
        </Button>
      </form>

      <div className="text-center mt-5 text-xs text-white/25">内部工具 — 如需访问请联系管理员</div>
    </div>
  );
}
