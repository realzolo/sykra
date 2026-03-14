import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import LoginClient from './LoginClient';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <LoginClient dict={dict} />;
}
