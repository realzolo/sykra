import { getRuleSets } from '@/services/db';
import RulesClient from './RulesClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const ruleSets = await getRuleSets();
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <RulesClient initialRuleSets={ruleSets} dict={dict} />;
}
