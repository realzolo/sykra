import RulesClient from './RulesClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export default async function RulesScreen() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <RulesClient dict={dict} />;
}
