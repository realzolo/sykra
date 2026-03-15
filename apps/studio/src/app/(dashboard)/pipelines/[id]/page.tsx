import PipelineDetailClient from './PipelineDetailClient';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function PipelineDetailPage({ params }: { params: { id: string } }) {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return <PipelineDetailClient dict={dict} pipelineId={params.id} />;
}
