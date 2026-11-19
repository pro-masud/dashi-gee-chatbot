import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { POST as couponsValidatePost } from '../app/api/coupons/validate/route';
import { POST as storefrontOrderPost } from '../app/api/orders/storefront/route';
import { GET as refillReminderGet } from '../app/api/orders/refill-reminder/route';
import {
  setRateLimitMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';

describe('UI/UX & P0 API hardening regressions', () => {
  beforeEach(() => {
    setRateLimitMemoryModeForTests(true);
  });

  afterEach(() => {
    setRateLimitMemoryModeForTests(false);
  });

  it('POST /api/coupons/validate enforces origin header and validates coupon format with bilingual errors', async () => {
    const noHeader = await couponsValidatePost(
      new Request('http://localhost:3000/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'DESHI10', subtotalBdt: 1500, uiLang: 'bn' }),
      })
    );
    assert.equal(noHeader.status, 403);

    const invalidFormat = await couponsValidatePost(
      new Request('http://localhost:3000/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          'x-forwarded-for': '198.51.100.11',
        },
        body: JSON.stringify({ code: '!', subtotalBdt: 1500, uiLang: 'bn' }),
      })
    );
    assert.equal(invalidFormat.status, 400);
    const badBody = (await invalidFormat.json()) as Record<string, any>;
    assert.equal(badBody.valid, false);
    assert.ok(typeof badBody.messageBn === 'string' && badBody.messageBn.length > 5);
    assert.equal(badBody.error, badBody.messageBn);
  });

  it('POST /api/orders/storefront returns Bangla localized validation errors when uiLang=bn', async () => {
    const res = await storefrontOrderPost(
      new Request('http://localhost:3000/api/orders/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          'x-forwarded-for': '198.51.100.12',
        },
        body: JSON.stringify({
          customerName: 'A',
          phone: '01712345678',
          district: 'Dhaka',
          area: 'Dhanmondi',
          address: 'House 12, Road 4, Dhanmondi',
          qty500g: 1,
          uiLang: 'bn',
        }),
      })
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.ok, false);
    assert.ok(typeof body.messageBn === 'string' && body.messageBn.includes('নাম'));
    assert.equal(body.error, body.messageBn);
  });

  it('GET /api/orders/refill-reminder validates order+phone format and rejects invalid credentials in Bangla', async () => {
    const res = await refillReminderGet(
      new Request(
        'http://localhost:3000/api/orders/refill-reminder?orderNumber=INVALID&phone=123&uiLang=bn',
        {
          headers: { 'x-forwarded-for': '198.51.100.13' },
        }
      )
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.ok, false);
    assert.equal(body.code, 'invalid_credentials');
    assert.equal(body.error, body.messageBn);
  });

  it('4-05 production start script uses next start directly and next-cli.mjs guards port cleanup to dev only', () => {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    assert.equal(pkg.scripts?.start, 'next start -H 0.0.0.0');

    const cliPath = path.join(process.cwd(), 'scripts', 'next-cli.mjs');
    const cliSource = fs.readFileSync(cliPath, 'utf8');
    assert.ok(
      cliSource.includes("if (command === 'dev' && process.env.NODE_ENV !== 'production')"),
      'next-cli.mjs must only run cleanupPreviousServers in non-production dev mode'
    );
  });
});
