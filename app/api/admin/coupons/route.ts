import { validateCouponInput } from '../../../../src/lib/coupons/coupons';
import { AdminSdkUnavailableError, getAdminDb, isAdminSdkCredentialOrIamError } from '../../../../src/lib/firebaseAdmin';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/admin/coupons — create or update one coupon (owner only).
 * usedCount is never touched here (only the order engine increments it, atomically).
 */
export async function PUT(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'catalog.manage' });
  if ('response' in auth) return auth.response;

  const parsed = validateCouponInput(await request.json().catch(() => null));
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const c = parsed.value;

  try {
    const db = getAdminDb();
    const ref = db.collection('coupons').doc(c.code);
    const nowIso = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const before = await tx.get(ref);
      tx.set(
        ref,
        {
          code: c.code,
          discountPct: c.discountPct,
          minSubtotalBdt: c.minSubtotalBdt,
          active: c.active,
          expiresAt: c.expiresAt,
          startsAt: c.startsAt,
          maxUses: c.maxUses,
          stackableWithAdvance: c.stackableWithAdvance,
          maxDiscountBdt: c.maxDiscountBdt,
          freeDelivery: c.freeDelivery,
          descriptionEn: c.descriptionEn,
          ...(before.exists ? {} : { usedCount: 0 }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(db.collection('activity_logs').doc(), {
        action: before.exists ? 'coupon.update' : 'coupon.create',
        resource: `coupons/${c.code}`,
        actorEmail: auth.actor.email,
        actorUid: auth.actor.uid,
        before: before.exists ? before.data() : null,
        after: c,
        atIso: nowIso,
      });
    });
    return jsonOk({ coupon: c });
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) return handleAdminError(new AdminSdkUnavailableError());
    return handleAdminError(err);
  }
}
