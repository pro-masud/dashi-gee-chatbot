import { NextResponse } from 'next/server';
import { getPaymentGatewayReadiness } from '../../../../src/lib/integrations/paymentGateway';

export const dynamic = 'force-dynamic';

/**
 * S0-06: Minimal public checkout payment-method availability endpoint.
 * Returns ONLY the payment method names/booleans the storefront checkout & tracking UI need.
 * Never exposes secrets, recentLogs, webhook URLs, AI model names, or security configuration.
 */
export async function GET() {
  const payments = getPaymentGatewayReadiness();
  const enabledMethods: string[] = ['cod', 'bkash_manual', 'nagad_manual'];
  if (payments.sslcommerz.configured) enabledMethods.push('sslcommerz');
  if (payments.bkash.configured) enabledMethods.push('bkash_online');

  return NextResponse.json(
    {
      ok: true,
      enabledMethods,
      onlineGateways: {
        sslcommerz: Boolean(payments.sslcommerz.configured),
        bkash: Boolean(payments.bkash.configured),
      },
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
