/**
 * Coupon validation for the admin — pure, browser-safe.
 * Coupons are applied by the server order engine; this only guards what the owner can save.
 */

export interface CouponInput {
  code: string;
  discountPct: number;
  minSubtotalBdt: number;
  active: boolean;
  expiresAt: string;
  startsAt: string;
  maxUses: number;
  stackableWithAdvance: boolean;
  /** Caps the coupon's discount in BDT (0 = no cap). */
  maxDiscountBdt: number;
  freeDelivery: boolean;
  descriptionEn: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCouponInput(raw: unknown): { ok: true; value: CouponInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid coupon.' };
  const b = raw as Record<string, unknown>;

  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return { ok: false, error: 'Code must be 3–20 characters: letters, numbers, - or _.' };

  const pct = Math.round(Number(b.discountPct));
  if (!Number.isFinite(pct) || pct < 0 || pct > 40) return { ok: false, error: 'Discount must be between 0% and 40%.' };

  const minSubtotal = Math.round(Number(b.minSubtotalBdt ?? 0));
  if (!Number.isFinite(minSubtotal) || minSubtotal < 0 || minSubtotal > 1_000_000) return { ok: false, error: 'Minimum order amount is invalid.' };

  const maxUses = Math.round(Number(b.maxUses ?? 0));
  if (!Number.isFinite(maxUses) || maxUses < 0 || maxUses > 1_000_000) return { ok: false, error: 'Usage limit is invalid.' };

  const cap = Math.round(Number(b.maxDiscountBdt ?? 0));
  if (!Number.isFinite(cap) || cap < 0 || cap > 1_000_000) return { ok: false, error: 'Maximum discount is invalid.' };
  if (cap > 0 && pct === 0) return { ok: false, error: 'A maximum discount only makes sense with a percentage above 0.' };

  const expiresAt = String(b.expiresAt || '').slice(0, 10);
  const startsAt = String(b.startsAt || '').slice(0, 10);
  if ((expiresAt && !DATE.test(expiresAt)) || (startsAt && !DATE.test(startsAt))) return { ok: false, error: 'Dates must be YYYY-MM-DD.' };
  if (startsAt && expiresAt && startsAt > expiresAt) return { ok: false, error: 'The start date is after the expiry date.' };

  const freeDelivery = b.freeDelivery === true;
  if (pct === 0 && !freeDelivery) return { ok: false, error: 'Set a percentage discount, free delivery, or both.' };

  return {
    ok: true,
    value: {
      code,
      discountPct: pct,
      minSubtotalBdt: minSubtotal,
      active: b.active !== false,
      expiresAt,
      startsAt,
      maxUses,
      stackableWithAdvance: b.stackableWithAdvance !== false,
      maxDiscountBdt: cap,
      freeDelivery,
      descriptionEn: String(b.descriptionEn || '').replace(/<[^>]*>/g, '').trim().slice(0, 120),
    },
  };
}
