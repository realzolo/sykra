import PipelinesClient from './PipelinesClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function PipelinesPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <PipelinesClient dict={dict} />;
}
