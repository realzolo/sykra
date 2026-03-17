import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import LoginClient from './LoginClient';
import { requireUser } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await requireUser();
  if (user) {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined);
    redirect(`/o/${orgId}`);
  }

  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const legalLinks = {
    terms: '/terms',
    privacy: '/privacy',
  };

  return <LoginClient dict={dict} locale={locale} legalLinks={legalLinks} />;
}
