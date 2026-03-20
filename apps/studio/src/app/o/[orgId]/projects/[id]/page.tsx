import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ orgId: string; id: string }>;
}) {
  const { orgId, id } = await params;
  redirect(`/o/${orgId}/projects/${id}/code-reviews`);
}
