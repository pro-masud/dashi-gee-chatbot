import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ThinkingLevel } from '@google/genai';
import {
  buildGeminiGenerateConfig,
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODEL,
} from '../src/lib/gemini/client';
import { buildStorefrontStructuredData } from '../src/lib/seo';
import { DEFAULT_STORE_SETTINGS } from '../src/lib/storeTypes';
import { DEFAULT_CHATBOT_CONFIG } from '../src/lib/chatbot/types';
import { CURATED_PRODUCT_KNOWLEDGE_PACK } from '../src/lib/chatbot/hybridRag';
import { TEST_CONFIRMED_STORE_SETTINGS } from './helpers/testStoreFixture';

const ROOT = process.cwd();

describe('Stage 4 — Chat & Storefront UI/UX, Latency Config, D15 Voice OFF, SEO Gate & Admin Provenance', () => {
  it('d20_gemini4_thinking_level_low_no_budget [static]: primary model is gemini-4-hydrogen with ThinkingLevel.LOW and NO thinkingBudget', () => {
    assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-4-hydrogen');
    assert.equal(FALLBACK_GEMINI_MODEL, 'gemini-3.1-flash-lite');
    const cfg = buildGeminiGenerateConfig({
      model: DEFAULT_GEMINI_MODEL,
      systemInstruction: 'Test system prompt',
    });
    assert.equal(cfg.thinkingConfig?.thinkingLevel, ThinkingLevel.LOW);
    assert.equal('thinkingBudget' in (cfg.thinkingConfig || {}), false);
    assert.equal(cfg.temperature, undefined);
  });

  it('d15_voice_features_off_by_default [static]: DEFAULT_CHATBOT_CONFIG disables voice/TTS and ChatPanel gates dictation & speak buttons behind enableVoiceFeatures', () => {
    assert.equal(DEFAULT_CHATBOT_CONFIG.enableVoiceFeatures, false);
    const chatPanelSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/chatbot/ChatPanel.tsx'),
      'utf8'
    );
    assert.match(chatPanelSrc, /chatbotConfig\.enableVoiceFeatures === true && speechSupported/);
    assert.match(chatPanelSrc, /chatbotConfig\.enableVoiceFeatures === true \? handleSpeakMessage : undefined/);
    // Ensure ZERO React hooks appear after the early `if (!open || minimized) { return null; }`
    const earlyReturnMatch = /if\s*\(\s*!open\s*\|\|\s*minimized\s*\)\s*\{\s*return\s+null;\s*\}/.exec(chatPanelSrc);
    assert.ok(earlyReturnMatch && earlyReturnMatch.index > 0);
    const afterEarlyReturn = chatPanelSrc.slice(earlyReturnMatch.index);
    assert.equal(/\buse(Effect|State|Memo|Ref|Callback)\s*\(/.test(afterEarlyReturn), false);
  });

  it('stage4_seo_jsonld_owner_confirmed_gate [mock]: JSON-LD omits unconfirmed offers and includes only owner-confirmed variant prices', () => {
    const unsetJsonLd = buildStorefrontStructuredData({
      settings: DEFAULT_STORE_SETTINGS,
      confirmedFromDb: true,
    });
    const productUnset = unsetJsonLd['@graph'].find((n) => n['@type'] === 'Product')!;
    assert.equal(productUnset.offers, undefined);

    const partialSettings = {
      ...TEST_CONFIRMED_STORE_SETTINGS,
      ownerConfirmedFields: {
        ...TEST_CONFIRMED_STORE_SETTINGS.ownerConfirmedFields,
        price1kg: false,
      },
    };
    const partialJsonLd = buildStorefrontStructuredData({
      settings: partialSettings,
      confirmedFromDb: true,
    });
    const productPartial = partialJsonLd['@graph'].find((n) => n['@type'] === 'Product') as {
      offers?: { offerCount: number; offers: { sku: string }[] };
    };
    assert.equal(productPartial.offers?.offerCount, 2);
    assert.deepEqual(
      productPartial.offers?.offers.map((o) => o.sku),
      ['DG-250G', 'DG-500G']
    );
  });

  it('stage4_track_view_token_and_d11_kb_provenance [static]: TrackOrderView supports ?token= auto-lookup and starter KB pack carries draft provenance', () => {
    const trackSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/TrackOrderView.tsx'),
      'utf8'
    );
    assert.match(trackSrc, /sp\.get\('token'\)/);
    assert.match(trackSrc, /trackOrderLookup\('', '', tokenParam\)/);

    assert.ok(CURATED_PRODUCT_KNOWLEDGE_PACK.length >= 4);
    for (const entry of CURATED_PRODUCT_KNOWLEDGE_PACK) {
      assert.equal(entry.active, false);
      assert.equal(entry.published, false);
      assert.ok(entry.sourceRef && entry.sourceRef.length > 0);
      assert.match(String(entry.draftNotice || ''), /owner review required/i);
    }
  });

  it('stage4_ordering_temporarily_unavailable_ui_no_fake_success [static]: BagCheckoutDrawer, ChatPanel, and HomeStorefrontView show clear friendly unavailable notice on 503 with zero fake confirmation', () => {
    const drawerSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/BagCheckoutDrawer.tsx'),
      'utf8'
    );
    assert.match(drawerSrc, /checkoutRes\.status === 503/);
    assert.match(drawerSrc, /admin_sdk_unavailable/);
    assert.match(drawerSrc, /Ordering is temporarily unavailable/);
    assert.match(drawerSrc, /No order was placed and no payment was charged/);
    assert.match(drawerSrc, /data-testid="ordering-temporarily-unavailable"/);

    const chatSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/chatbot/ChatPanel.tsx'),
      'utf8'
    );
    assert.match(chatSrc, /res\.status === 503/);
    assert.match(chatSrc, /admin_sdk_unavailable/);
    assert.match(chatSrc, /Ordering is temporarily unavailable right now/);
    assert.match(chatSrc, /No order was placed and no payment was charged/);

    const homeSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/HomeStorefrontView.tsx'),
      'utf8'
    );
    assert.match(homeSrc, /data-testid="storefront-ordering-unavailable"/);
    assert.match(homeSrc, /Ordering is temporarily unavailable/);
  });
});

