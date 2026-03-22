import { redirect } from 'next/navigation';

import AccountScreen from '@/features/account/AccountScreen';
import { loadAccountPageData } from '@/features/account/accountPageData';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const data = await loadAccountPageData();
  if (!data) {
    redirect('/login');
  }

  return <AccountScreen initialData={data} />;
}
