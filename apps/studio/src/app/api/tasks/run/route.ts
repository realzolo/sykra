import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: 'Task execution moved to the Conductor service. Use CONDUCTOR_BASE_URL.' },
    { status: 410 }
  );
}
