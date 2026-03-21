import RuleSetDetailClient from './RuleSetDetailClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export default async function RuleSetDetailScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return <RuleSetDetailClient ruleSetId={id} dict={dict} />;
}
