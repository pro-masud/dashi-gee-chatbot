import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as activityGet } from '../app/api/admin/activity/route';
import { GET as meGet } from '../app/api/admin/me/route';
import { PATCH as staffPatch, POST as staffPost, GET as staffGet } from '../app/api/admin/staff/route';
import {
  ASSIGNABLE_ROLES,
  PERMISSIONS,
  permissionsForRole,
  roleFromStaffDoc,
  roleHasPermission,
  validateStaffInput,
} from '../src/lib/auth/permissions';

describe('RBAC — roles, permissions, staff management', () => {
  it('owner has every permission', () => {
    for (const p of PERMISSIONS) assert.equal(roleHasPermission('owner', p), true, p);
  });

  it('call agents can work orders but never see money, logs or staff', () => {
    assert.equal(roleHasPermission('call_agent', 'orders.view'), true);
    assert.equal(roleHasPermission('call_agent', 'orders.update'), true);
    for (const p of ['finance.view', 'finance.manage', 'cod.manage', 'logs.view', 'staff.manage'] as const) {
      assert.equal(roleHasPermission('call_agent', p), false, p);
    }
  });

  it('accountant sees money and logs but cannot change order status or manage staff', () => {
    for (const p of ['finance.view', 'finance.manage', 'cod.manage', 'logs.view', 'orders.view'] as const) {
      assert.equal(roleHasPermission('accountant', p), true, p);
    }
    assert.equal(roleHasPermission('accountant', 'orders.update'), false);
    assert.equal(roleHasPermission('accountant', 'staff.manage'), false);
  });

  it('delivery manager records COD but cannot see profit', () => {
    assert.equal(roleHasPermission('delivery_manager', 'cod.manage'), true);
    assert.equal(roleHasPermission('delivery_manager', 'orders.update'), true);
    assert.equal(roleHasPermission('delivery_manager', 'finance.view'), false);
  });

  it('only the owner can manage staff', () => {
    const withStaffManage = (['owner', 'call_agent', 'delivery_manager', 'accountant'] as const).filter((r) =>
      roleHasPermission(r, 'staff.manage')
    );
    assert.deepEqual(withStaffManage, ['owner']);
    assert.equal(ASSIGNABLE_ROLES.includes('owner' as never), false);
  });

  it('permissionsForRole returns a copy that cannot mutate the role table', () => {
    const list = permissionsForRole('call_agent');
    list.push('finance.view');
    assert.equal(roleHasPermission('call_agent', 'finance.view'), false);
  });

  it('inactive, unknown or owner-claiming staff docs get no role', () => {
    assert.equal(roleFromStaffDoc({ email: 'a@b.co', role: 'accountant', active: true }), 'accountant');
    assert.equal(roleFromStaffDoc({ email: 'a@b.co', role: 'accountant', active: false }), null);
    assert.equal(roleFromStaffDoc({ email: 'a@b.co', role: 'superuser', active: true }), null);
    assert.equal(roleFromStaffDoc({ email: 'a@b.co', role: 'owner', active: true }), null); // staff can never be owner
    assert.equal(roleFromStaffDoc(null), null);
  });

  it('staff input validation', () => {
    assert.equal(validateStaffInput({ email: 'Agent@Example.com', role: 'call_agent' }).ok, true);
    assert.equal(validateStaffInput({ email: 'not-an-email', role: 'call_agent' }).ok, false);
    assert.equal(validateStaffInput({ email: 'a@b.co', role: 'owner' }).ok, false);
    assert.equal(validateStaffInput({ email: 'a@b.co', role: 'god' }).ok, false);
    const ok = validateStaffInput({ email: 'Agent@Example.com', role: 'accountant' });
    if (ok.ok) assert.equal(ok.value.email, 'agent@example.com');
  });

  it('staff / me / activity APIs reject unauthenticated callers', async () => {
    assert.equal((await staffGet(new Request('http://localhost:3000/api/admin/staff'))).status, 401);
    assert.equal((await meGet(new Request('http://localhost:3000/api/admin/me'))).status, 401);
    assert.equal((await activityGet(new Request('http://localhost:3000/api/admin/activity'))).status, 401);
    const post = await staffPost(
      new Request('http://localhost:3000/api/admin/staff', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ email: 'a@b.co', role: 'call_agent' }),
      })
    );
    assert.equal(post.status, 401);
  });

  it('staff mutations require the CSRF header', async () => {
    const res = await staffPatch(
      new Request('http://localhost:3000/api/admin/staff', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: 'abcdef123', active: false }),
      })
    );
    assert.equal(res.status, 403);
  });
});
