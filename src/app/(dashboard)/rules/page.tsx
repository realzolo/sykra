import { getRuleSets } from '@/services/db';
import RulesClient from './RulesClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const locale = await getLocale();
  const [ruleSets, dict] = await Promise.all([getRuleSets(), getDictionary(locale)]);

  return <RulesClient initialRuleSets={ruleSets} dict={dict} />;
}
