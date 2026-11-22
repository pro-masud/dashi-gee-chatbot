/**
 * Package (jar size) management — pure rules, browser-safe (no server imports).
 *
 * The order engine sells three fixed size slots. This module adds the commercial layer around them:
 * regular vs offer price, cost of goods, badges, default selection and enable/disable.
 *
 * Price the customer pays  = offerPrice when set (and lower than regular), otherwise regularPrice.
 * The order engine keeps reading that single price, so it cannot disagree with what the page shows.
 */

export const PACKAGE_SLOTS = ['250g', '500g', '1kg'] as const;
export type PackageSlot = (typeof PACKAGE_SLOTS)[number];

export const PACKAGE_BADGES = ['', 'popular', 'best_value'] as const;
export type PackageBadge = (typeof PACKAGE_BADGES)[number];

export const PACKAGE_BADGE_LABELS: Record<PackageBadge, { en: string; bn: string }> = {
  '': { en: 'No badge', bn: 'কোনো ব্যাজ নয়' },
  popular: { en: 'Most popular', bn: 'সবচেয়ে জনপ্রিয়' },
  best_value: { en: 'Best value', bn: 'সেরা মূল্য' },
};

export interface PackageConfig {
  slot: PackageSlot;
  /** Normal price in BDT (shown struck through when an offer price is set). */
  regularPrice: number;
  /** Selling price in BDT. 0 = no offer, customers pay the regular price. */
  offerPrice: number;
  /** Cost of goods per jar in BDT. 0 = not set. */
  cogs: number;
  /** Jars in stock. */
  stock: number;
  badge: PackageBadge;
  enabled: boolean;
  isDefault: boolean;
  description: string;
}

export type PackagesState = Record<PackageSlot, PackageConfig>;

export const SLOT_LABELS: Record<PackageSlot, string> = { '250g': '250g jar', '500g': '500g jar', '1kg': '1kg jar' };

export function defaultPackage(slot: PackageSlot): PackageConfig {
  return {
    slot,
    regularPrice: 0,
    offerPrice: 0,
    cogs: 0,
    stock: 0,
    badge: '',
    enabled: true,
    isDefault: slot === '500g',
    description: '',
  };
}

export function defaultPackagesState(): PackagesState {
  return { '250g': defaultPackage('250g'), '500g': defaultPackage('500g'), '1kg': defaultPackage('1kg') };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The price a customer actually pays for one jar. */
export function sellingPrice(p: Pick<PackageConfig, 'regularPrice' | 'offerPrice'>): number {
  if (p.offerPrice > 0 && (p.regularPrice <= 0 || p.offerPrice < p.regularPrice)) return p.offerPrice;
  return p.regularPrice;
}

export interface PackageEconomics {
  sellingPrice: number;
  discountBdt: number;
  discountPct: number;
  /** null when cost is not set — we never invent a cost */
  profitPerJar: number | null;
  marginPct: number | null;
}

export function packageEconomics(p: PackageConfig): PackageEconomics {
  const price = sellingPrice(p);
  const discount = p.regularPrice > price && price > 0 ? p.regularPrice - price : 0;
  const hasCost = p.cogs > 0 && price > 0;
  return {
    sellingPrice: price,
    discountBdt: round2(discount),
    discountPct: p.regularPrice > 0 && discount > 0 ? round2((discount / p.regularPrice) * 100) : 0,
    profitPerJar: hasCost ? round2(price - p.cogs) : null,
    marginPct: hasCost ? round2(((price - p.cogs) / price) * 100) : null,
  };
}

export function validatePackagesInput(
  raw: unknown
): { ok: true; value: PackagesState } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid packages payload.' };
  const body = raw as Record<string, unknown>;
  const out = defaultPackagesState();

  for (const slot of PACKAGE_SLOTS) {
    const p = (body[slot] ?? null) as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return { ok: false, error: `Missing package ${slot}.` };

    const num = (key: string, max: number): number | null => {
      const n = Number(p[key] ?? 0);
      return Number.isFinite(n) && n >= 0 && n <= max ? round2(n) : null;
    };
    const regularPrice = num('regularPrice', 1_000_000);
    const offerPrice = num('offerPrice', 1_000_000);
    const cogs = num('cogs', 1_000_000);
    const stock = Number(p.stock ?? 0);
    if (regularPrice === null || offerPrice === null || cogs === null) {
      return { ok: false, error: `${slot}: prices and cost must be between 0 and 1,000,000.` };
    }
    if (!Number.isInteger(stock) || stock < 0 || stock > 100_000) {
      return { ok: false, error: `${slot}: stock must be a whole number between 0 and 100,000.` };
    }
    if (regularPrice <= 0) return { ok: false, error: `${slot}: regular price must be greater than 0.` };
    if (offerPrice > 0 && offerPrice >= regularPrice) {
      return { ok: false, error: `${slot}: offer price must be lower than the regular price (or 0 for no offer).` };
    }
    if (cogs > 0 && cogs >= sellingPrice({ regularPrice, offerPrice })) {
      return { ok: false, error: `${slot}: cost per jar is not lower than the selling price — check the numbers.` };
    }
    const badge = String(p.badge ?? '') as PackageBadge;
    if (!PACKAGE_BADGES.includes(badge)) return { ok: false, error: `${slot}: unknown badge.` };

    out[slot] = {
      slot,
      regularPrice,
      offerPrice,
      cogs,
      stock,
      badge,
      enabled: p.enabled !== false,
      isDefault: p.isDefault === true,
      description: String(p.description ?? '').trim().slice(0, 200),
    };
  }

  const enabledSlots = PACKAGE_SLOTS.filter((s) => out[s].enabled);
  if (enabledSlots.length === 0) return { ok: false, error: 'At least one package must stay enabled.' };

  // exactly one default, and it must be an enabled package
  const requested = PACKAGE_SLOTS.filter((s) => out[s].isDefault && out[s].enabled);
  const defaultSlot = requested[0] ?? (out['500g'].enabled ? '500g' : enabledSlots[0]);
  for (const s of PACKAGE_SLOTS) out[s].isDefault = s === defaultSlot;

  return { ok: true, value: out };
}

/** Public, customer-safe view (never includes cost of goods or stock counts). */
export interface PublicPackageMeta {
  regularPrice: number;
  sellingPrice: number;
  discountPct: number;
  badge: PackageBadge;
  enabled: boolean;
  isDefault: boolean;
  description: string;
}

export type PublicPackages = Record<PackageSlot, PublicPackageMeta>;

export function toPublicPackages(state: PackagesState): PublicPackages {
  const out = {} as PublicPackages;
  for (const slot of PACKAGE_SLOTS) {
    const p = state[slot];
    const e = packageEconomics(p);
    out[slot] = {
      regularPrice: p.regularPrice,
      sellingPrice: e.sellingPrice,
      discountPct: e.discountPct,
      badge: p.badge,
      enabled: p.enabled,
      isDefault: p.isDefault,
      description: p.description,
    };
  }
  return out;
}

/** Slots with a positive quantity in an order that the owner has disabled. */
export function disabledSlotsInOrder(
  qty: { qty250g: number; qty500g: number; qty1kg: number },
  enabled: Record<PackageSlot, boolean>
): PackageSlot[] {
  const used: Record<PackageSlot, number> = { '250g': qty.qty250g, '500g': qty.qty500g, '1kg': qty.qty1kg };
  return PACKAGE_SLOTS.filter((s) => used[s] > 0 && enabled[s] === false);
}
