import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import ResetClient from '@/features/auth/ResetClient';

export const dynamic = 'force-dynamic';

export default async function ResetPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return <ResetClient dict={dict} />;
}
