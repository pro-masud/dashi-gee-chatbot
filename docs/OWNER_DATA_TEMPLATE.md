# Deshi Gee — Owner Business Data Template

> **Rule**: Never publish guessed or placeholder business facts. Fill in only confirmed values below and enter them into `/admin` → **Store Settings** and **Batches**. Any field left blank remains `unset` and is cleanly hidden on the storefront and withheld by the AI assistant.

## 1. Jar Pricing & Live Stock (Required to Enable Checkout)
| Variant | Confirmed Price (BDT) | Confirmed Available Stock (Jars) |
| --- | --- | --- |
| 250g Glass Jar | `[ENTER BDT]` | `[ENTER COUNT]` |
| 500g Glass Jar | `[ENTER BDT]` | `[ENTER COUNT]` |
| 1kg Glass Jar | `[ENTER BDT]` | `[ENTER COUNT]` |

## 2. Delivery Fees & Timelines (Required to Enable Checkout)
- **Inside Dhaka Delivery Fee (BDT)**: `[ENTER BDT]`
- **Inside Dhaka ETA (EN / BN)**: `[e.g., Within 24–48 hours / ২৪–৪৮ ঘণ্টার মধ্যে]`
- **Outside Dhaka Delivery Fee (BDT)**: `[ENTER BDT]`
- **Outside Dhaka ETA (EN / BN)**: `[e.g., 2–4 working days / ২–৪ কর্মদিবস]`
- **Same-Day Dispatch Cut-Off Time (optional)**: `[LEAVE BLANK IF UNCONFIRMED]`
- **Free Delivery Threshold (BDT, `0` if none)**: `[ENTER 0 OR THRESHOLD]`

## 3. Payment Channels
- **Cash on Delivery (COD)**: `[Enabled / Disabled]`
- **bKash Number (leave blank if inactive)**: `[01XXXXXXXXX]` (`Merchant` or `Personal`)
- **Nagad Number (leave blank if inactive)**: `[01XXXXXXXXX]` (`Merchant` or `Personal`)
- **Advance Payment Discount % (`0` if none)**: `[0]`

## 4. Verified Customer Contact & Location
- **Support Phone**: `[+8801XXXXXXXXX]`
- **WhatsApp Number**: `[+8801XXXXXXXXX]`
- **Support Email**: `[support@yourdomain.com]`
- **Business Hours (BST)**: `[Open Hour]` – `[Close Hour]`
- **Support SLA (Urgent / Standard minutes, optional)**: `[LEAVE BLANK IF UNCONFIRMED]`
- **Physical Address (EN / BN, optional)**: `[ENTER CONFIRMED ADDRESS]`
- **Google Maps Link (optional)**: `[https://maps.google.com/...]`

## 5. Active Batch Record (Optional — Leave Empty Until First Batch Is Confirmed)
- **Batch Code**: `[e.g., DG-2026-B01]`
- **Production / Churn Date**: `[YYYY-MM-DD]`
- **Best Before Date**: `[YYYY-MM-DD]`
- **Origin / Source Note (Confirmed only)**: `[ENTER CONFIRMED NOTE]`
- **Lab / Quality Certificate Ref (ONLY if real certificate exists)**: `[LEAVE BLANK IF NONE]`

## 6. Approved Product Claims & Policies
- Review `docs/POLICY_REVIEW_LIST.md` before setting `NEXT_PUBLIC_ENABLE_POLICY_DRAFTS=true`.
- Review each draft entry in `Admin → Chatbot → FAQ / Knowledge Base` before publishing.
- **Strictly Prohibited unless backed by real uploaded documentation**: BSTI certification numbers, Organic/A2/Bilona/Grass-fed claims, medical/cure claims, fake review counts.
