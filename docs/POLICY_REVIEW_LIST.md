# Deshi Gee — Policy Review List (Stage 1.4 · Decision D10)

> **Status:** ALL storefront policy modal text is **hidden by default** behind `NEXT_PUBLIC_ENABLE_POLICY_DRAFTS=true` and clearly labelled **"DRAFT – owner review required"** whenever previewed.  
> **Owner action required:** Review, edit, or replace every sentence below with your legally accurate, confirmed store policies before enabling policy modals in production.

---

## 1. Delivery Policy (Draft)

| # | Draft Sentence (EN / BN) | Contains Promise / Number / Legal Claim? | Owner Decision Required |
|---|---|---|---|
| 1 | EN: *"Delivery fees and estimated timelines follow the owner-confirmed rates shown live at checkout."* | References checkout rates/ETAs (no invented numbers). | Confirm zone rates (`insideDhakaFee`, `dhakaSuburbanFee`, `outsideDhakaFee`, `remoteDistrictFee`), ETAs, dispatch cut-off hour, and free-delivery threshold in Admin Settings. |
| 2 | BN: *"ডেলিভারি চার্জ ও সম্ভাব্য সময় চেকআউটে প্রদর্শিত মালিক-অনুমোদিত সেটিংস অনুযায়ী প্রযোজ্য।"* | References checkout rates/ETAs. | Approve Bangla wording and specify courier partners / delivery attempts policy. |
| — | **Previously removed unconfirmed claims:** `৳80 / ৳100 / ৳130 / ৳160`, `24–48 hours`, `2–3 days`, `4–6 days`, `2:00 PM BST same-day dispatch`, `Free delivery above ৳2,500`. | Yes (numeric fees & SLA promises) — **REMOVED from code defaults**. | Confirm actual figures in `store_settings/main` or keep hidden. |

---

## 2. Return & Refund Policy (Draft)

| # | Draft Sentence (EN / BN) | Contains Promise / Number / Legal Claim? | Owner Decision Required |
|---|---|---|---|
| 1 | EN: *"If a jar arrives damaged or with an open tamper seal, contact support with a photo for review under our owner-confirmed policy."* | Describes review process without promising automatic refund or time window. | Define exact claim window (e.g., X hours after delivery), evidence requirements, refund vs. replacement rules, and return shipping responsibility. |
| 2 | BN: *"ক্ষতিগ্রস্ত বা সিল খোলা পার্সেল পেলে ছবি সহ আমাদের সাপোর্ট টিমের সাথে যোগাযোগ করুন। রিটার্ন/রিফান্ড সিদ্ধান্ত মালিক-অনুমোদিত নীতিমালা অনুযায়ী টিম পর্যালোচনা করবে।"* | Describes review process only. | Confirm Bangla legal wording & refund processing timeline (bKash/Nagad/bank). |
| — | **Previously removed unconfirmed claims:** `"24h Replacement Guarantee"`, `"7-day return"`, `"100% replacement within 24 hours"`. | Yes (guarantee & deadline promises) — **REMOVED from code defaults**. | State whether a guarantee or return window exists and its exact conditions. |

---

## 3. Privacy Policy (Draft)

| # | Draft Sentence (EN / BN) | Contains Promise / Number / Legal Claim? | Owner Decision Required |
|---|---|---|---|
| 1 | EN: *"Customer names, phone numbers, delivery addresses, and chat transcripts are used solely for fulfillment and support, subject to store retention settings."* | Legal/privacy statement on data purpose and retention. | Confirm exact retention periods (chat logs, order records, payment proofs, marketing opt-ins), data controller contact (owner name/email), and deletion request procedure under Bangladesh Digital Commerce / Cyber Security laws. |
| 2 | BN: *"ক্রেতাদের নাম, মোবাইল নম্বর ও ডেলিভারি ঠিকানা শুধুমাত্র অর্ডার ডেলিভারি, সাপোর্ট এবং যাচাইয়ের জন্য সংরক্ষণ করা হয়। চ্যাট ও অর্ডার ডেটা সংরক্ষণের সময়সীমা অ্যাডমিন সেটিংস অনুযায়ী নির্ধারিত।"* | Legal/privacy statement. | Approve Bangla translation and list third-party processors (Google Cloud/Firebase, Gemini API, courier partners, SMS/payment gateways). |

---

## 4. Terms & Conditions (Draft)

| # | Draft Sentence (EN / BN) | Contains Promise / Number / Legal Claim? | Owner Decision Required |
|---|---|---|---|
| 1 | EN: *"All confirmed prices are listed in Bangladeshi Taka (BDT). Mobile payments remain pending verification until confirmed by our team."* | Pricing currency & manual MFS verification disclosure. | Confirm legal business entity / trade licence details, order cancellation cut-off rules, COD refusal rules, and dispute jurisdiction (Bangladesh courts). |
| 2 | BN: *"সকল মূল্য বাংলাদেশি টাকায় (BDT) প্রদর্শিত। মোবাইল পেমেন্ট আমাদের টিম যাচাই করার পর চূড়ান্ত নিশ্চিত হয়।"* | Pricing currency & MFS verification disclosure. | Approve Bangla wording and add trade licence / TIN / DBID once available. |

---

## 5. Product & Starter Knowledge Pack Claims Removed (Pending Owner Approval)

The following previously hardcoded product claims were removed from storefront components, `deshiGeeData.ts`, `DEFAULT_CHATBOT_CONFIG`, and `CURATED_PRODUCT_KNOWLEDGE_PACK` (which is now **DRAFT only**, `active: false, published: false`):

- `"Lab Tested Authenticity"` / `"100% Lab Tested Purity"` / `"100% Pure"`
- `"24h Replacement Guarantee"`
- `"DG-PAB-2026-042"` placeholder batch code and fake dates/lab report status
- `"18°C"`, `"36°C"`, `"250°C"`, `"32°C–34°C"` temperature/smoke-point figures
- `"12 months"` / `"12 মাস"` shelf-life claim
- `"5% advance discount"` and `"DESHI10"` sample coupon prefill

**Owner action:** Enter only true, verified values in the Admin Console (with per-field confirmation) or keep them `unset`.
