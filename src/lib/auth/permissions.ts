/**
 * Role-based access control — pure rules (no I/O).
 *
 * Roles are fixed and simple on purpose:
 *  - owner             full access (the bootstrapped owner and legacy admins)
 *  - call_agent        sees and confirms orders, never money or settings
 *  - delivery_manager  runs fulfilment and records COD cash / settlements
 *  - accountant        reads money and logs, records COD and expenses
 *
 * Every new server API checks a permission key; the browser UI only hides menu items for convenience.
 */

export const PERMISSIONS = [
  'orders.view',
  'orders.update',
  'leads.manage',
  'cod.manage',
  'finance.view',
  'finance.manage',
  'logs.view',
  'staff.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['owner', 'call_agent', 'delivery_manager', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that can be assigned to staff (owner is reserved for the store owner). */
export const ASSIGNABLE_ROLES: Role[] = ['call_agent', 'delivery_manager', 'accountant'];

export const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Full access to everything.' },
  call_agent: {
    label: 'Call agent',
    description: 'View orders, work incomplete-order leads and move orders through the pipeline. Cannot see profit, expenses or COD money.',
  },
  delivery_manager: {
    label: 'Delivery manager',
    description: 'Manage fulfilment and record COD cash collection and courier settlements.',
  },
  accountant: {
    label: 'Accountant',
    description: 'View orders, profit & expenses, COD settlements and the activity log. Cannot change order status.',
  },
};

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  call_agent: ['orders.view', 'orders.update', 'leads.manage'],
  delivery_manager: ['orders.view', 'orders.update', 'cod.manage'],
  accountant: ['orders.view', 'finance.view', 'finance.manage', 'cod.manage', 'logs.view'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export interface StaffDoc {
  email: string;
  role: string;
  active: boolean;
}

/** Resolve the effective role from a staff document. Inactive or unknown roles get no access. */
export function roleFromStaffDoc(doc: Partial<StaffDoc> | null | undefined): Role | null {
  if (!doc || doc.active !== true) return null;
  if (!isRole(doc.role) || doc.role === 'owner') return null;
  return doc.role;
}

export function validateStaffInput(
  raw: unknown
): { ok: true; value: { email: string; role: Role } } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid staff payload.' };
  const b = raw as Record<string, unknown>;
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const role = b.role;
  if (!isRole(role) || !ASSIGNABLE_ROLES.includes(role)) {
    return { ok: false, error: 'Choose a staff role: call agent, delivery manager or accountant.' };
  }
  return { ok: true, value: { email, role } };
}
