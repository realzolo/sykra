import { notFound } from 'next/navigation';
import { getRuleSetById } from '@/services/db';
import RuleSetDetailClient from './RuleSetDetailClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function RuleSetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const [ruleSet, dict] = await Promise.all([
    getRuleSetById(id).catch(() => null),
    getDictionary(locale),
  ]);
  if (!ruleSet) notFound();
  return <RuleSetDetailClient initialRuleSet={ruleSet} dict={dict} />;
}
