import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { locales, type Locale } from '@/i18n/config';

export async function POST(request: NextRequest) {
  try {
    const { locale } = await request.json();

    if (!locale || !locales.includes(locale as Locale)) {
      return NextResponse.json(
        { error: 'Invalid locale' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    cookieStore.set('NEXT_LOCALE', locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to set locale' },
      { status: 500 }
    );
  }
}
