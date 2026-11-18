# Deshi Gee Chatbot — Phase 1 Knowledge Base & Content Audit

This document records the verified facts grounded in live Firestore + storefront defaults versus items that require explicit store-owner verification before enabling any related marketing claim.

## 1. Verified Facts (Grounded Live via `store_settings` & `DEFAULT_CHATBOT_CONFIG`)
- **Brand & Single Product**: Deshi Gee (`Single-origin Pabna grass-fed bilona cow ghee` from Bera & Faridpur, Pabna).
- **Available Glass Jar Variants**: `250g` (trial/solo), `500g` (everyday family), `1kg` (value/cooking/gifting) packaged in airtight food-grade clear apothecary glass jars with tamper seals.
- **Process**: Dawn raw milk collection → overnight earthen clay-pot curd (`dahi`) fermentation → morning wooden `bilona` hand-churning → slow clarification → fine muslin straining.
- **Texture & Storage**: Granular (`danadar`) crystals at ~18°C–24°C, liquid gold above ~32°C–34°C; 12-month shelf life when kept sealed in a cool dry spot away from sunlight/stove heat with a clean dry spoon (no refrigeration required).
- **Live Pricing & Stock**: Read dynamically per turn from Firestore `store_settings` (`price250g`, `price500g`, `price1kg`, `stock250g`, `stock500g`, `stock1kg`).
- **Delivery & Payment**: Dhaka (`deliveryFeeDhaka`) vs Nationwide outside Dhaka (`deliveryFeeOutsideDhaka`), free delivery threshold (`freeDeliveryThreshold`), Cash on Delivery (`COD`), and configured bKash/Nagad MFS numbers.
- **Replacement Policy**: Delivery-day photo evidence within 24 hours of a cracked jar or broken tamper seal qualifies for prompt replacement/refund.

## 2. Seeded Curated KB Pack (`CURATED_PRODUCT_KNOWLEDGE_PACK`)
Admins can click **"Seed Verified KB Pack"** inside Admin → AI Chatbot → Knowledge Docs to add these verified Q&A entries cleanly without duplicates:
1. High-heat cooking suitability (`halua`, `polao`, `khichuri`, `paratha`, daily `bhaat`).
2. Seasonal texture shift (`danadar` granular crystals in winter vs liquid gold in summer).
3. Glass jar packaging rationale vs plastic containers (`250g`, `500g`, `1kg` Bangla FAQ).
4. Variant guidance (`250g` vs `500g` vs `1kg` choosing criteria).

## 3. Owner-Confirmation Gaps (Strictly Guarded Until Verified)
The response guard (`BLOCKED_CLAIMS` / `approvedClaimsMeta`) actively blocks unverified answers on these topics until the owner uploads supporting records or updates Store/Chatbot Settings:
- **BSTI License / Certification Number & Formal Lab PDF Report**: Do not claim BSTI certification or lab-tested purity without uploading the certificate and adding a dated `ApprovedClaimMeta` entry.
- **A2 / Organic Certifications**: Blocked by default unless valid certification records are added to `approvedClaimsMeta`.
- **Medical / Therapeutic Claims**: Any claim that ghee "cures" or "treats" medical conditions remains permanently disallowed.
- **Seasonal / Eid Dispatch Cutoff Dates**: Store owner should publish seasonal shipping cutoffs in Knowledge Docs (`status: published`, `accessScope: public`).
- **Verified Physical Pickup Address / Google Maps URL**: Pending owner confirmation inside Admin → Brand & Business Info (`googleMapsUrl`, `directionsUrl`).
