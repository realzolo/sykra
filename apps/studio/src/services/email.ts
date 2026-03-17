type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

type EmailProvider = 'console' | 'resend';

function provider(): EmailProvider {
  const raw = (process.env.EMAIL_PROVIDER ?? 'console').trim().toLowerCase();
  if (raw === 'resend') return 'resend';
  return 'console';
}

function baseUrl(): string | null {
  const raw = (process.env.STUDIO_BASE_URL ?? '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function absoluteStudioUrl(path: string): string | null {
  const base = baseUrl();
  if (!base) return null;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const p = provider();

  if (p === 'console') {
    // Intentionally minimal to avoid leaking secrets into logs.
    // Useful for local development when no email provider is configured.
    // eslint-disable-next-line no-console
    console.log('[email:console]', { to: input.to, subject: input.subject });
    return;
  }

  if (p === 'resend') {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
    if (!from) throw new Error('EMAIL_FROM is not configured');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Resend send failed: ${res.status} ${text}`);
    }

    return;
  }

  const never: never = p;
  throw new Error(`Unsupported email provider: ${never}`);
}

