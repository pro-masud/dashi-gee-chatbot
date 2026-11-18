import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'deshi-gee-storefront',
    runtime: 'nextjs-app-router',
  });
}
