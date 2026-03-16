import { redirect } from 'next/navigation';

export default function OrgRootPage({ params }: { params: { orgId: string } }) {
  redirect(`/o/${params.orgId}/projects`);
}
