export type AdminHelpSectionKey =
  | 'overview'
  | 'orders'
  | 'store_pricing_stock'
  | 'store_delivery_payments'
  | 'store_contact_social'
  | 'batches'
  | 'coupons'
  | 'reviews'
  | 'refill_reminders'
  | 'subscribers'
  | 'chatbot_studio'
  | 'chatbot_funnel'
  | 'chatbot_unanswered'
  | 'integrations_overview'
  | 'telegram_bot'
  | 'discord_webhooks'
  | 'whatsapp_cloud'
  | 'meta_channels'
  | 'payment_gateways'
  | 'courier_partners'
  | 'sms_email_gateways'
  | 'notification_rules'
  | 'notification_templates'
  | 'notification_history_dlq'
  | 'diagnostics_suite';

export interface AdminHelpEntry {
  key: AdminHelpSectionKey;
  title: string;
  subtitle: string;
  howToUse: {
    whatItDoes: string;
    whenToUse: string;
    steps: string[];
    notes?: string[];
  };
  frontendImpact: {
    summary: string;
    affectedAreas: string[];
    liveTiming: string;
  };
  testAndTroubleshoot: {
    howToVerify: string[];
    commonIssues: Array<{ symptom: string; fix: string }>;
  };
}

export const ADMIN_HELP_CONTENT: Record<AdminHelpSectionKey, AdminHelpEntry> = {
  overview: {
    key: 'overview',
    title: 'Overview & Live Business KPIs',
    subtitle: 'Real-time order counts, revenue summary, and recent webhook delivery activity.',
    howToUse: {
      whatItDoes:
        'Displays live order totals (Total, Pending, Confirmed, Delivered), cumulative BDT sales, your 6 most recent orders, and server webhook delivery logs.',
      whenToUse:
        'Check this tab first each morning to spot pending COD orders that need confirmation and ensure alerts are delivering cleanly.',
      steps: [
        'Review the Pending counter at the top to see new orders waiting for confirmation.',
        'Click the Orders tab to inspect details, verify bKash/Nagad TxIDs, or book courier parcels.',
        'Check the Owner Notification Webhook Log card on the right for recent server alert statuses.',
      ],
    },
    frontendImpact: {
      summary: 'Read-only monitoring view — viewing this tab does not modify the customer storefront.',
      affectedAreas: ['No direct customer-facing changes from this screen.'],
      liveTiming: 'Metrics refresh automatically whenever you click Sync or reload the dashboard.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Place a test order on the storefront or run the Storefront Display check in Integrations & Alerts → Diagnostics.',
        'Confirm the Total Orders count increases by 1 and the order appears under Recent Orders.',
      ],
      commonIssues: [
        {
          symptom: 'All numbers show 0 even though orders exist',
          fix: 'Verify you are signed in with the owner email (kinboni.bd@gmail.com) and that Firestore Admin SDK IAM roles are active in Diagnostics.',
        },
        {
          symptom: 'Webhook log says skipped_unconfigured',
          fix: 'Set up Telegram, Discord, or direct email/webhook credentials in server environment variables and re-test.',
        },
      ],
    },
  },

  orders: {
    key: 'orders',
    title: 'Order Management, Receipts & Courier Booking',
    subtitle: 'Search orders, verify COD/MFS payments, book couriers, export CSV, and print receipts.',
    howToUse: {
      whatItDoes:
        'Central fulfillment workspace for every Deshi Gee order. Lets you filter by status or risk review, update lifecycle statuses, verify manual bKash/Nagad payments, book Steadfast/Pathao/RedX parcels, and print thermal/A4 packing slips.',
      whenToUse:
        'Use continuously throughout the day to confirm incoming orders, review flagged COD risk orders, dispatch parcels, and handle customer cancellations.',
      steps: [
        'Use the search box or status dropdown (including Manual Risk Review) to locate an order.',
        'Click an order card to open its Order Receipt & Controls drawer.',
        'Verify payment status (bKash/Nagad TxID or COD due) and update the order status (Confirmed → Processing → Shipped → Delivered).',
        'Book a courier consignment (Steadfast, Pathao, or RedX) or enter a manual tracking code.',
        'Click Print Receipt for packing slips or Export CSV for accounting.',
      ],
      notes: [
        'Every status change automatically updates the customer Order Tracking page and triggers configured Telegram/Discord/WhatsApp notifications.',
        'Suspicious or high-value COD orders are highlighted with a Review Risk badge so you can call the customer before shipping.',
      ],
    },
    frontendImpact: {
      summary: 'Directly updates what customers see on the Order Tracking page and triggers status notifications.',
      affectedAreas: [
        'Customer Order Tracking timeline (/track) updates immediately when status or courier tracking changes.',
        'Order cancellation restores jar inventory counts when processed through the server.',
        'Configured WhatsApp/Telegram/Discord order alerts fire automatically on status transitions.',
      ],
      liveTiming: 'Takes effect immediately upon saving an order update.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Update a test order status from Pending to Confirmed and open the Order Tracking view using that Order ID + phone number.',
        'Verify the new status and courier tracking link appear accurately.',
      ],
      commonIssues: [
        {
          symptom: 'Courier booking returns courier_not_configured',
          fix: 'Add Steadfast, Pathao, or RedX API credentials on the server, or select Manual courier to enter tracking codes yourself.',
        },
        {
          symptom: 'Pathao or RedX booking rejects missing city/area ID',
          fix: 'Configure PATHAO_CITY_ZONE_MAP_JSON or REDX_AREA_ID_MAP_JSON on the server (check Integrations & Alerts → Diagnostics).',
        },
      ],
    },
  },

  store_pricing_stock: {
    key: 'store_pricing_stock',
    title: 'Single-Product Pricing & Jar Stock',
    subtitle: 'Controls live 250g, 500g, and 1kg jar prices and real-time inventory counts.',
    howToUse: {
      whatItDoes:
        'Sets the official BDT selling price and available jar inventory for each of Deshi Gee’s three jar sizes (250g, 500g, 1kg).',
      whenToUse:
        'Update whenever ghee harvest batch pricing changes, when new jars are bottled, or when a jar size sells out.',
      steps: [
        'Enter the exact confirmed BDT price for each jar size you want available for sale (enter 0 to hide/mark a size unavailable).',
        'Enter the current physical jar stock count for each size.',
        'Inspect the Live Frontend Impact Preview panel below the form to confirm how customers will see prices and stock.',
        'Click Save Storefront Configuration to publish live.',
      ],
      notes: [
        'Deshi Gee never invents fallback prices. If all jar prices are 0 or unset, customers safely see "Ordering is temporarily unavailable" instead of fake numbers.',
        'Stock automatically decrements when orders are placed, and Low Stock Alerts trigger once stock drops to or below your threshold in Notification Rules.',
      ],
    },
    frontendImpact: {
      summary: 'Directly controls Hero pricing, jar selector cards, Add-to-Order buttons, Checkout totals, and AI Chatbot price answers.',
      affectedAreas: [
        'Homepage Hero & Jar Selector cards (250g / 500g / 1kg prices and In Stock / Out of Stock badges).',
        'Checkout Drawer subtotal and server-side order price calculation.',
        'AI Support Chatbot live price & stock responses (always grounded strictly in these values).',
      ],
      liveTiming: 'Published live to the storefront immediately after clicking Save Storefront Configuration.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Check the Live Frontend Impact Preview before saving.',
        'After saving, run the Storefront Display check in Integrations & Alerts → Diagnostics, or reload the homepage.',
      ],
      commonIssues: [
        {
          symptom: 'Homepage still shows "Ordering is temporarily unavailable"',
          fix: 'Ensure at least one jar price (> 0) AND at least one base delivery fee (Dhaka City or Nationwide > 0) are saved.',
        },
        {
          symptom: 'AI Chatbot says price is unconfirmed',
          fix: 'Save confirmed prices here; the chatbot reads live from Firestore store_settings.',
        },
      ],
    },
  },

  store_delivery_payments: {
    key: 'store_delivery_payments',
    title: 'Bangladesh Delivery Zones, Thresholds & MFS Numbers',
    subtitle: 'Zone delivery fees, ETAs, dispatch cut-off, free-delivery bar, bKash/Nagad numbers, and COD policy.',
    howToUse: {
      whatItDoes:
        'Configures all 4 Bangladesh delivery zones (Dhaka City, Dhaka Suburban, Nationwide, Remote Districts), delivery time estimates, same-day dispatch cut-off hour (BST), free-delivery threshold, manual bKash/Nagad merchant numbers, and advance-payment discount percentage.',
      whenToUse:
        'Set up before launching your store, and update whenever courier rates change, free-shipping promotions run, or merchant MFS numbers change.',
      steps: [
        'Enter BDT delivery fees for Dhaka City, Dhaka Suburban, Nationwide, and Remote Districts.',
        'Set Free Delivery Threshold (BDT) — enter 0 if you do not want a free-delivery promotion banner.',
        'Optionally set Dispatch Cutoff Hour (0–23 BST, e.g. 15 for 3:00 PM) and High-Value COD Flag threshold.',
        'Enter your real bKash and Nagad numbers (leave blank to hide that payment option from Checkout).',
        'Review the Live Frontend Impact Preview and click Save Storefront Configuration.',
      ],
      notes: [
        'Leaving bKash or Nagad blank hides that option from customer Checkout so customers never send money to a placeholder number.',
        'Automated SSLCommerz / bKash Tokenized Checkout API keys are managed separately on the server (see Integrations & Alerts).',
      ],
    },
    frontendImpact: {
      summary: 'Controls the top announcement bar, Checkout delivery fee calculation, payment methods shown to buyers, and chatbot delivery quotes.',
      affectedAreas: [
        'Top Announcement Bar (displays Free Delivery threshold when > 0).',
        'Checkout Drawer delivery fee auto-calculation by district/zone.',
        'Checkout Payment Methods (shows bKash / Nagad instructions & advance discount only when valid numbers are saved).',
        'AI Chatbot delivery fee, ETA, and payment instructions.',
      ],
      liveTiming: 'Published live to the storefront immediately after saving.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Review the Checkout Payment Methods & Announcement Bar inside the Frontend Impact Preview.',
        'Open the storefront Checkout Drawer and switch districts between Dhaka and outside Dhaka to confirm fee updates.',
      ],
      commonIssues: [
        {
          symptom: 'bKash or Nagad does not appear in Checkout',
          fix: 'Verify you entered a real 11-digit Bangladesh number (not a placeholder like 01700000000) and saved.',
        },
        {
          symptom: 'Free delivery banner is hidden',
          fix: 'Set Free Delivery Threshold to a positive BDT amount (e.g., 2500) and save.',
        },
      ],
    },
  },

  store_contact_social: {
    key: 'store_contact_social',
    title: 'Storefront Contact, Origin & Active Batch Code',
    subtitle: 'Public WhatsApp, phone, support email, business address, and active QR batch code.',
    howToUse: {
      whatItDoes:
        'Sets the customer-facing WhatsApp number, support phone, support email, business address, and the active production batch code displayed on product provenance badges.',
      whenToUse:
        'Configure during initial store setup and update Active Batch Code whenever you begin shipping a new Pabna ghee batch.',
      steps: [
        'Enter your real WhatsApp support number and phone number (Bangladesh format, e.g. 017XXXXXXXX).',
        'Enter your real Support Email and Business Address.',
        'Enter the Active Batch Code matching a batch record saved under the Batches & Coupons tab.',
        'Verify how contacts look in the Frontend Impact Preview and click Save Storefront Configuration.',
      ],
    },
    frontendImpact: {
      summary: 'Directly populates the website footer, floating/contact WhatsApp links, printable receipts, and chatbot human-escalation contacts.',
      affectedAreas: [
        'Storefront Footer contact links and business address.',
        'Customer WhatsApp support buttons and AI Chatbot human handoff contact info.',
        'Order Receipt header and active Batch Provenance badge.',
      ],
      liveTiming: 'Published live immediately after clicking Save Storefront Configuration.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Check the Contact & WhatsApp preview card in the Frontend Impact Preview.',
        'Visit the homepage footer and verify your phone, email, and WhatsApp link open properly.',
      ],
      commonIssues: [
        {
          symptom: 'WhatsApp button or email does not show on the site',
          fix: 'Placeholder values (such as example.com, hello@deshigee.com, or 000000 numbers) are intentionally suppressed for safety. Enter your real business details.',
        },
      ],
    },
  },

  batches: {
    key: 'batches',
    title: 'Batch Provenance & Lab Record',
    subtitle: 'Publish QR-verifiable production dates, origin district, licence info, and lab PDF links.',
    howToUse: {
      whatItDoes:
        'Stores verified production batch records (Batch Code, Origin District, Production & Expiry dates, Regulatory Licence details, and Lab Report PDF URL) that customers inspect via the Batch Lookup / QR provenance page.',
      whenToUse:
        'Create a new record every time a fresh ghee batch is churned, tested, and jarred — then set its code as the Active Batch Code in Store Settings.',
      steps: [
        'Enter a unique Batch Code (e.g. DG-PAB-2026-11).',
        'Fill in Origin District, Production Date, and Expiry Date.',
        'Add your BSTI/regulatory licence details and an HTTPS URL to the lab report PDF (if available).',
        'Click Save Batch Record.',
      ],
    },
    frontendImpact: {
      summary: 'Powers the customer Batch Verification / QR Provenance page and lab report download button.',
      affectedAreas: [
        'Public Batch Lookup page (/batch/[code] and homepage provenance section).',
        'AI Chatbot batch & purity verification replies.',
      ],
      liveTiming: 'Available immediately once saved.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Save a batch record and look up its code on the storefront Batch Verification section.',
        'Confirm dates, origin, and lab PDF link open cleanly.',
      ],
      commonIssues: [
        {
          symptom: 'Lab Report link does not appear',
          fix: 'Ensure the URL begins with https:// and has no trailing spaces.',
        },
      ],
    },
  },

  coupons: {
    key: 'coupons',
    title: 'Promo Coupons & Discount Rules',
    subtitle: 'Create server-validated percentage discount codes with minimums, expiry, and usage caps.',
    howToUse: {
      whatItDoes:
        'Creates promotional discount codes validated strictly on the server during Checkout so customers cannot tamper with totals.',
      whenToUse:
        'Use for Eid/Ramadan campaigns, repeat-buyer rewards, or influencer promo codes.',
      steps: [
        'Enter an uppercase Coupon Code (e.g. EID10), Discount % (1–50), and Minimum Subtotal (BDT).',
        'Optionally set an ISO expiry date (e.g. 2027-12-31T23:59:59Z) and Max Uses (0 = unlimited).',
        'Choose whether the coupon can stack with the Advance MFS Discount.',
        'Click Save Coupon Code.',
      ],
    },
    frontendImpact: {
      summary: 'Enables the coupon code inside the Checkout Drawer with live discount validation.',
      affectedAreas: [
        'Checkout Drawer coupon input and server-calculated order total.',
        'Order summary receipts showing applied promo code.',
      ],
      liveTiming: 'Active immediately in Checkout once saved.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Open the storefront Checkout Drawer, add jars meeting the Minimum Subtotal, and apply the coupon code.',
        'Confirm the discount percentage subtracts accurately from the subtotal.',
      ],
      commonIssues: [
        {
          symptom: 'Coupon says invalid or not eligible',
          fix: 'Check that cart subtotal meets Min Subtotal, Max Uses has not been reached, and Expires At is in the future.',
        },
      ],
    },
  },

  reviews: {
    key: 'reviews',
    title: 'Customer Review Moderation Queue',
    subtitle: 'Approve, verify, reject, or delete customer-submitted reviews before they go public.',
    howToUse: {
      whatItDoes:
        'Holds customer reviews submitted from the storefront in a moderation queue so spam or unverified submissions never appear automatically.',
      whenToUse:
        'Review weekly (or after deliveries) to publish authentic customer testimonials with Verified Purchase badges.',
      steps: [
        'Read each pending customer review, rating, and district.',
        'Click Approve & Verify to publish the review to the live storefront with a verified badge.',
        'Click Reject to keep it hidden, or click the trash icon to permanently delete spam.',
      ],
    },
    frontendImpact: {
      summary: 'Only Approved reviews appear in the storefront Customer Reviews section and average rating.',
      affectedAreas: [
        'Homepage Customer Reviews & Verified Rating section.',
      ],
      liveTiming: 'Approved reviews appear immediately upon refresh of the storefront.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Approve a review here and reload the storefront reviews section to confirm it renders cleanly.',
      ],
      commonIssues: [
        {
          symptom: 'Submitted review is not visible on the homepage',
          fix: 'All new reviews require explicit Approve & Verify moderation here before appearing publicly.',
        },
      ],
    },
  },

  refill_reminders: {
    key: 'refill_reminders',
    title: 'Opt-In Customer Refill Reminders',
    subtitle: 'Manage recurring ghee refill schedules and dispatch due reminders.',
    howToUse: {
      whatItDoes:
        'Tracks customers who opted into periodic ghee refill reminders (e.g., every 30 or 45 days) and dispatches reminders via configured messaging webhooks.',
      whenToUse:
        'Use Preview Due to inspect upcoming reminders, or click Dispatch Due to send reminders manually (also supported via automated cron).',
      steps: [
        'Check the "due" counter beside the section title.',
        'Click Preview Due to dry-run and verify which customers are due without sending messages.',
        'Click Dispatch Due to send reminders and automatically advance each customer’s next due date.',
      ],
    },
    frontendImpact: {
      summary: 'Sends outbound refill reminders to opted-in customers; does not alter storefront layout.',
      affectedAreas: [
        'Customer refill reminder notifications (via configured WhatsApp/Email webhooks).',
      ],
      liveTiming: 'Dispatches immediately when you click Dispatch Due.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Click Preview Due first to confirm the server reads active reminders cleanly with zero errors.',
      ],
      commonIssues: [
        {
          symptom: 'Dispatch Due button is disabled',
          fix: 'The button activates automatically only when at least 1 opted-in reminder is currently due.',
        },
      ],
    },
  },

  subscribers: {
    key: 'subscribers',
    title: 'Newsletter Subscribers',
    subtitle: 'View email subscribers collected from the storefront newsletter signup.',
    howToUse: {
      whatItDoes:
        'Lists email addresses and preferred language (EN/BN) of visitors who subscribed via the storefront footer.',
      whenToUse:
        'Review subscriber growth or reference opted-in emails when planning new harvest announcements.',
      steps: [
        'Inspect each subscriber’s email address and preferred language code.',
      ],
    },
    frontendImpact: {
      summary: 'Read-only directory populated by the storefront newsletter form.',
      affectedAreas: ['Storefront Footer newsletter signup writes into this list.'],
      liveTiming: 'New signups appear immediately after refreshing.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Submit a test email in the storefront footer and refresh Admin to confirm it appears here.',
      ],
      commonIssues: [
        {
          symptom: 'List is empty',
          fix: 'No visitors have subscribed yet, or Firestore Admin SDK is unavailable in preview.',
        },
      ],
    },
  },

  chatbot_studio: {
    key: 'chatbot_studio',
    title: 'AI Chatbot Studio, Knowledge Base & Inbox',
    subtitle: 'Configure Deshi Gee’s bilingual AI assistant, FAQs, system policies, human takeover, and support tickets.',
    howToUse: {
      whatItDoes:
        'Controls the entire customer-facing AI assistant shared across the Website Chat Widget and WhatsApp/Meta webhooks. Manage greetings, tone, FAQs, brand story, policies, live playground tests, human agent takeover, and escalation tickets.',
      whenToUse:
        'Update whenever you add new FAQs, refine support policies, take over a live customer chat, or resolve an escalated ticket.',
      steps: [
        'Check the Server Gemini Engine ribbon at the top to confirm whether live Gemini AI or DB Fallback is active.',
        'Edit settings, FAQs, or policies, click Save Draft, test in the Playground, and click Publish Live.',
        'Use the Conversations & Tickets sub-tabs to pause AI on a specific customer chat and reply as a human agent.',
      ],
      notes: [
        'Saving a draft does NOT affect customers until you click Publish Live.',
        'Pricing, delivery fees, and order tracking always pull live from Firestore — the AI never invents prices.',
      ],
    },
    frontendImpact: {
      summary: 'Directly controls the floating Website AI Chatbot widget and automated WhatsApp/Messenger/Instagram replies once published.',
      affectedAreas: [
        'Floating Website Chatbot widget (welcome message, quick replies, FAQ answers, tone).',
        'Omnichannel AI responses on WhatsApp Business, Messenger, and Instagram.',
        'Human handoff ticket creation and live agent replies in customer chat.',
      ],
      liveTiming: 'Drafts stay private; Published changes go live immediately.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Use the built-in Playground inside Chatbot Studio to ask a Bangla & English price/delivery question.',
        'Run the Gemini AI check in Integrations & Alerts → Diagnostics.',
      ],
      commonIssues: [
        {
          symptom: 'Ribbon shows Live DB Fallback Engine',
          fix: 'Set GEMINI_API_KEY in server environment variables. The chatbot still works safely using deterministic DB answers until the key is added.',
        },
      ],
    },
  },

  chatbot_funnel: {
    key: 'chatbot_funnel',
    title: 'Chat-to-Order Funnel & Revenue Attribution',
    subtitle: 'Tracks how website and social chat conversations convert into real Deshi Gee orders.',
    howToUse: {
      whatItDoes:
        'Measures the 6-stage conversion funnel from Chat Started through Product Info, Checkout Intent, and Verified Orders, along with attributed Average Order Value (AOV).',
      whenToUse:
        'Review weekly to see which customer questions drive orders and where shoppers drop off.',
      steps: [
        'Compare Chat Started against Completed Orders to spot drop-off stages.',
        'Use insights to improve quick-reply buttons or add missing FAQs.',
      ],
    },
    frontendImpact: {
      summary: 'Analytics view only — does not change the storefront directly.',
      affectedAreas: ['No direct storefront changes.'],
      liveTiming: 'Updated automatically from live chat sessions and order attribution.',
    },
    testAndTroubleshoot: {
      howToVerify: ['Start a website chat session and inspect the updated funnel counters.'],
      commonIssues: [
        {
          symptom: 'Funnel counters are 0',
          fix: 'No customer chat sessions have been logged yet or Firestore persistence is inactive.',
        },
      ],
    },
  },

  chatbot_unanswered: {
    key: 'chatbot_unanswered',
    title: 'Unanswered Questions Queue',
    subtitle: 'Turn real customer questions the AI could not answer into verified FAQs with one click.',
    howToUse: {
      whatItDoes:
        'Captures customer questions where the AI had low confidence or escalated to human support, letting you write an official answer and convert it directly into a published FAQ.',
      whenToUse:
        'Check every few days to continuously improve chatbot accuracy without developer help.',
      steps: [
        'Read each unanswered customer question.',
        'Click Write Answer & Save as FAQ to add the verified answer to your Knowledge Base.',
        'Publish your Chatbot config so future customers get the answer immediately.',
      ],
    },
    frontendImpact: {
      summary: 'Converting questions into FAQs and publishing improves future Website and WhatsApp chatbot answers.',
      affectedAreas: ['Website AI Chatbot and WhatsApp/Meta automated Q&A.'],
      liveTiming: 'Active after saving the FAQ and publishing Chatbot Studio changes.',
    },
    testAndTroubleshoot: {
      howToVerify: ['Ask the same question in the Chatbot Playground after publishing to confirm the new FAQ is used.'],
      commonIssues: [
        {
          symptom: 'New FAQ not appearing in replies',
          fix: 'Ensure you clicked Publish Live in the top Chatbot Studio ribbon after saving the FAQ.',
        },
      ],
    },
  },

  integrations_overview: {
    key: 'integrations_overview',
    title: 'Integrations & Server Credentials Overview',
    subtitle: 'Central readiness status for every messaging, AI, payment, and courier integration.',
    howToUse: {
      whatItDoes:
        'Shows live server configuration status for every real Deshi Gee integration: Telegram Bot, Discord Webhooks, WhatsApp Cloud API, Meta Messenger/Instagram, Google Gemini AI, SSLCommerz & bKash Payment Gateways, Steadfast/Pathao/RedX Couriers, and BulkSMSBD/Twilio/Resend messaging.',
      whenToUse:
        'Use this overview to see which services are Ready vs Not Configured, copy exact webhook callback URLs, and launch live connection tests.',
      steps: [
        'Review each integration card to see its live status (Ready, Configured, or Not Configured).',
        'For security, private API keys and secrets are stored strictly in Cloud Run / Server Environment Variables (never exposed to the browser or saved in plain Firestore docs).',
        'Use the Configure or Diagnostics buttons on any card to adjust operational settings or test live connectivity.',
      ],
      notes: [
        'Webhook URLs shown here can be copied with one click and pasted directly into Meta, Payment, or Courier dashboards.',
      ],
    },
    frontendImpact: {
      summary: 'Controls background notifications, automated payment/courier callbacks, and omnichannel customer support.',
      affectedAreas: [
        'Admin order & support alerts (Telegram, Discord, Email).',
        'Customer WhatsApp, Messenger, Instagram, and SMS updates.',
        'Online Checkout payment gateways (SSLCommerz / bKash) and Courier tracking webhooks.',
      ],
      liveTiming: 'Operational toggles save immediately; server env secret changes apply on server restart/redeploy.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Open the Diagnostics & Tests tab and click Run All Safe Checks.',
        'Verify each configured service returns Success.',
      ],
      commonIssues: [
        {
          symptom: 'Integration shows Not Configured after setting env vars locally',
          fix: 'Restart the server or redeploy Cloud Run with the new secret bindings, then click Refresh.',
        },
      ],
    },
  },

  telegram_bot: {
    key: 'telegram_bot',
    title: 'Telegram Admin Notification Bot',
    subtitle: 'Instant real-time alerts to your personal Telegram or Ops group chat.',
    howToUse: {
      whatItDoes:
        'Dispatches HTML-formatted admin alerts (new orders, payment verifications, support escalations, low stock, daily summaries) via the official Telegram Bot API.',
      whenToUse:
        'Configure when you want instant mobile notifications for store events without checking the dashboard manually.',
      steps: [
        'Open Telegram, message @BotFather, run /newbot, and copy your Bot Token.',
        'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your server environment / Cloud Secret Manager.',
        'Start a chat with your bot (/start) or add it to your admin group.',
        'Optionally enter comma-separated numeric Chat IDs in the override box here and click Save Telegram Settings.',
        'Click Send Test Ping to confirm real message delivery.',
      ],
      notes: [
        'Customer phone numbers are automatically masked in Telegram alerts for privacy.',
        'Group/supergroup IDs typically start with -100 (e.g., -1001234567890).',
      ],
    },
    frontendImpact: {
      summary: 'Internal admin alert channel — does not change the customer-facing storefront.',
      affectedAreas: ['Admin Telegram chat(s) only.'],
      liveTiming: 'Enable/disable and chat ID overrides apply immediately upon saving.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Click Send Test Ping and confirm a message titled "Deshi Gee Telegram Connection Test" arrives in your Telegram chat.',
      ],
      commonIssues: [
        {
          symptom: 'Error: Forbidden: bot was blocked or chat not found',
          fix: 'Open your bot in Telegram and send /start, or add the bot to your admin group as a member.',
        },
        {
          symptom: 'Status 503 Not Configured',
          fix: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your server environment.',
        },
      ],
    },
  },

  discord_webhooks: {
    key: 'discord_webhooks',
    title: 'Discord 6-Channel Ops Webhooks',
    subtitle: 'Route business alerts into dedicated color-coded Discord operations channels.',
    howToUse: {
      whatItDoes:
        'Posts rich, structured Discord embeds into up to 6 dedicated channels: #new-orders, #payments, #customer-support, #inventory-alerts, #daily-reports, and #system-alerts.',
      whenToUse:
        'Ideal for operations teams that track orders, payments, inventory, and support tickets in organized Discord channels.',
      steps: [
        'In Discord, open a channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.',
        'Set the matching server env variable (e.g. DISCORD_WEBHOOK_ORDERS) or set a single fallback DISCORD_WEBHOOK_URL for all channels.',
        'Use the Active checkboxes here to pause or enable individual channels without deleting webhooks.',
        'Click Save Discord Channel Toggles, then click Test on each channel.',
      ],
    },
    frontendImpact: {
      summary: 'Internal admin operations channel — zero customer-facing UI impact.',
      affectedAreas: ['Your team’s Discord server channels only.'],
      liveTiming: 'Channel active toggles take effect immediately upon saving.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Click Test next to any configured channel and verify the formatted embed card appears in Discord.',
      ],
      commonIssues: [
        {
          symptom: 'Discord webhook HTTP 404 Unknown Webhook',
          fix: 'The webhook was deleted in Discord. Create a new webhook URL and update the server env var.',
        },
      ],
    },
  },

  whatsapp_cloud: {
    key: 'whatsapp_cloud',
    title: 'WhatsApp Business Cloud API',
    subtitle: 'Policy-compliant customer order updates and AI support via official Meta Cloud API.',
    howToUse: {
      whatItDoes:
        'Connects Deshi Gee to Meta’s official WhatsApp Cloud API for two-way AI customer support and policy-compliant proactive order confirmations & status updates.',
      whenToUse:
        'Enable once your Meta Business App & WhatsApp Business Account (WABA) are approved and you have Meta-approved utility templates.',
      steps: [
        'In Meta Business Settings, create a System User with whatsapp_business_messaging permission and generate a permanent Access Token.',
        'Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_VERIFY_TOKEN, and WHATSAPP_APP_SECRET on the server.',
        'Register the Webhook Callback URL (/api/channels/webhook) in Meta App Dashboard → WhatsApp → Configuration.',
        'Enter your exact Meta-approved Utility Template names and language code (e.g. en_US) here and save.',
        'Click Verify Meta Graph Connection to confirm live API authentication.',
      ],
      notes: [
        'Meta WhatsApp Policy: Outside the 24-hour customer-initiated window, proactive messages require explicit customer opt-in AND an approved utility template. Deshi Gee enforces this automatically.',
      ],
    },
    frontendImpact: {
      summary: 'Controls automated WhatsApp replies and opt-in customer order confirmation/status messages.',
      affectedAreas: [
        'Customer WhatsApp chat experience (AI replies and order update templates).',
        'Inbound WhatsApp messages automatically appear in Chatbot Studio Inbox.',
      ],
      liveTiming: 'Template names and toggles take effect immediately upon saving.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Click Verify Meta Graph Connection to confirm your Phone Number ID and verified business display name.',
      ],
      commonIssues: [
        {
          symptom: 'WhatsApp Graph HTTP 401 OAuthException',
          fix: 'Temporary developer tokens expire after 24 hours. Switch to a permanent System User token.',
        },
        {
          symptom: 'Jobs show skipped_disabled: missing_customer_opt_in',
          fix: 'Expected safety behavior when a customer has not opted into proactive WhatsApp alerts or is outside the 24-hour care window.',
        },
      ],
    },
  },

  meta_channels: {
    key: 'meta_channels',
    title: 'Meta Messenger & Instagram DM Webhook',
    subtitle: 'Receive and answer Facebook Messenger and Instagram messages through Deshi Gee’s AI Support Engine.',
    howToUse: {
      whatItDoes:
        'Verifies signed Meta webhooks on /api/channels/webhook so inbound Messenger and Instagram DMs route into the shared AI Support Engine and Admin Inbox.',
      whenToUse:
        'Configure when you want customers messaging your Facebook Page or Instagram account to receive grounded Deshi Gee answers.',
      steps: [
        'Copy your Meta App Secret (META_APP_SECRET) and create a random Verify Token (META_VERIFY_TOKEN) on the server.',
        'Optional: add META_PAGE_ACCESS_TOKEN for automated outbound replies.',
        'Paste your /api/channels/webhook URL into Meta App Dashboard → Webhooks and subscribe to messages.',
      ],
    },
    frontendImpact: {
      summary: 'Enables automated AI support on Facebook Messenger and Instagram DMs; no website UI changes.',
      affectedAreas: ['Facebook Page Messenger & Instagram Direct Messages.'],
      liveTiming: 'Active as soon as Meta verifies the webhook subscription.',
    },
    testAndTroubleshoot: {
      howToVerify: ['Run the Meta Messenger/Instagram test in Diagnostics & Tests.'],
      commonIssues: [
        {
          symptom: 'Meta webhook verification fails during setup',
          fix: 'Confirm META_VERIFY_TOKEN in server env matches the exact string entered in Meta Dashboard.',
        },
      ],
    },
  },

  payment_gateways: {
    key: 'payment_gateways',
    title: 'Online Payment Gateways (SSLCommerz & bKash PGW)',
    subtitle: 'Server-verified online payments with cryptographic IPN & callback validation.',
    howToUse: {
      whatItDoes:
        'Manages automated online payment checkout and server-side verification for SSLCommerz and bKash Tokenized Checkout.',
      whenToUse:
        'Configure once you receive sandbox or live merchant credentials from SSLCommerz or bKash PGW.',
      steps: [
        'Keep credentials strictly in server environment variables (SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWD, or BKASH_APP_KEY / SECRET / USERNAME / PASSWORD).',
        'Set SSLCOMMERZ_IS_LIVE=false or BKASH_IS_LIVE=false while testing in Sandbox mode.',
        'Ensure NEXT_PUBLIC_SITE_URL is set to your HTTPS domain so /api/payments/callback receives gateway redirects and IPN notifications.',
      ],
    },
    frontendImpact: {
      summary: 'Enables automated online payment initiation and automatic "Verified" payment status updates on orders.',
      affectedAreas: ['Checkout payment callback flow and order payment verification status.'],
      liveTiming: 'Active once server credentials are configured and deployed.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Run the Payment Gateways diagnostic in Diagnostics & Tests (bKash performs a charge-free auth token check; SSLCommerz validates readiness safely).',
      ],
      commonIssues: [
        {
          symptom: 'bKash auth fails with invalid credentials',
          fix: 'Verify BKASH_IS_LIVE matches your Sandbox vs Production credentials and check IP whitelisting with bKash.',
        },
      ],
    },
  },

  courier_partners: {
    key: 'courier_partners',
    title: 'Bangladesh Courier APIs (Steadfast, Pathao, RedX)',
    subtitle: 'One-click parcel booking from Orders and automated delivery status webhooks.',
    howToUse: {
      whatItDoes:
        'Connects your Orders tab to Steadfast, Pathao Hermes, and RedX APIs for direct parcel creation and authenticated webhook tracking updates (/api/couriers/webhook).',
      whenToUse:
        'Set up to eliminate manual copy-pasting of customer addresses into courier portals.',
      steps: [
        'Add your courier API keys to server env vars (STEADFAST_API_KEY/SECRET_KEY, PATHAO_*, or REDX_API_TOKEN).',
        'Set COURIER_WEBHOOK_SECRET (12+ random chars) and register /api/couriers/webhook in your courier merchant dashboard.',
        'For Pathao or RedX, also configure the district-to-ID JSON map env vars.',
      ],
    },
    frontendImpact: {
      summary: 'Automatically syncs live courier status updates (Shipped, Delivered) onto the customer Order Tracking page.',
      affectedAreas: ['Customer Order Tracking page (/track) and order shipment notifications.'],
      liveTiming: 'Applies immediately whenever a parcel is booked or a courier webhook arrives.',
    },
    testAndTroubleshoot: {
      howToVerify: ['Run the Courier Partners check in Diagnostics & Tests (verifies credentials without booking a fake parcel).'],
      commonIssues: [
        {
          symptom: 'Courier webhook returns 401 Unauthorized',
          fix: 'Ensure COURIER_WEBHOOK_SECRET matches the secret header or HMAC signature configured in your courier portal.',
        },
      ],
    },
  },

  sms_email_gateways: {
    key: 'sms_email_gateways',
    title: 'Direct SMS & Transactional Email (BulkSMSBD, Twilio, Resend)',
    subtitle: 'Server-side transactional email alerts and Bangladesh SMS gateways.',
    howToUse: {
      whatItDoes:
        'Provides direct transactional email via Resend and direct Bangladesh SMS delivery via BulkSMSBD or Twilio.',
      whenToUse:
        'Configure when you want email order alerts in your inbox or direct SMS updates for customers without WhatsApp.',
      steps: [
        'For Email: set RESEND_API_KEY, RESEND_FROM_EMAIL (verified domain), and OWNER_NOTIFICATION_EMAIL.',
        'For SMS: set BULKSMSBD_API_KEY & BULKSMSBD_SENDER_ID (or Twilio SID/Token/From).',
        'Use Diagnostics & Tests → Send Test Email to confirm inbox delivery.',
      ],
    },
    frontendImpact: {
      summary: 'Delivers order confirmation emails/SMS and owner alerts; does not alter storefront layout.',
      affectedAreas: ['Customer SMS/Email notifications and Owner inbox alerts.'],
      liveTiming: 'Active as soon as server env credentials are set.',
    },
    testAndTroubleshoot: {
      howToVerify: ['Click Send Test Email in Diagnostics & Tests to confirm Resend delivers to your inbox.'],
      commonIssues: [
        {
          symptom: 'Resend returns HTTP 403 domain not verified',
          fix: 'Verify your sender domain DNS records inside Resend Dashboard before sending from RESEND_FROM_EMAIL.',
        },
      ],
    },
  },

  notification_rules: {
    key: 'notification_rules',
    title: 'Event Routing Matrix & Retry Policy',
    subtitle: 'Choose exactly which business events notify Telegram, Discord, and WhatsApp — and how retries behave.',
    howToUse: {
      whatItDoes:
        'Controls per-event activation and channel routing for all 10 Deshi Gee events, plus retry limits, exponential backoff timing, low-stock threshold, and owner email override.',
      whenToUse:
        'Adjust whenever you want to reduce alert noise, route a specific event to a channel, or change when low-stock alerts fire.',
      steps: [
        'Toggle the Enabled column to turn any business event completely on or off.',
        'Check or uncheck Telegram, Discord, and WhatsApp for each event row.',
        'Set Low Stock Alert Threshold (number of jars remaining before a LOW_STOCK alert fires).',
        'Configure Max Retry Attempts (1–8) and Base Backoff Seconds (5–600) for failed deliveries.',
        'Click Save Notification Rules.',
      ],
    },
    frontendImpact: {
      summary: 'Controls both internal admin alerts and customer-facing WhatsApp order notifications.',
      affectedAreas: [
        'Telegram & Discord admin alerts.',
        'WhatsApp customer order confirmations and status notifications.',
        'Low-stock inventory warnings triggered during checkout.',
      ],
      liveTiming: 'New routing rules apply immediately to all subsequent events.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Save your rules, then open History & DLQ and click Test Alert or Send Daily Summary to confirm enabled channels receive the job.',
      ],
      commonIssues: [
        {
          symptom: 'Event is checked here but no alert arrived',
          fix: 'Verify the channel itself is also enabled in its tab (Telegram/Discord/WhatsApp) and has valid server credentials.',
        },
      ],
    },
  },

  notification_templates: {
    key: 'notification_templates',
    title: 'Custom Message Templates & Live Preview',
    subtitle: 'Customize titles, message bodies, email subjects, and WhatsApp wording with dynamic variables.',
    howToUse: {
      whatItDoes:
        'Lets you personalize the exact wording of notifications for each of the 10 business events using clickable dynamic variables (like {{customer_name}}, {{order_id}}, {{order_total}}), control Admin vs Customer targeting, and preview live output before saving.',
      whenToUse:
        'Use whenever you want to customize brand tone, include Bangla/English wording, or tailor what details appear in Telegram, Discord, Email, and WhatsApp messages.',
      steps: [
        'Select a Business Event from the dropdown.',
        'Choose the Recipient Scope (Admin Only, Customer Only, or Both Admin & Customer).',
        'Edit Title Template, Message Body Template, Email Subject, or WhatsApp 24h Message.',
        'Click any Supported Variable chip to insert it cleanly at the end of the active field.',
        'Check the Live Rendered Preview box to see realistic sample output.',
        'Click Save Message Template, or click Send Live Test to verify directly in Telegram or Discord.',
      ],
      notes: [
        'Only variables genuinely supported by the selected event are shown, preventing broken placeholders.',
        'Click Reset Event to Default at any time to restore the built-in template.',
      ],
    },
    frontendImpact: {
      summary: 'Directly changes the text of customer-facing WhatsApp 24h updates and admin Telegram/Discord alerts.',
      affectedAreas: [
        'Telegram alert title & body text.',
        'Discord embed title & description.',
        'WhatsApp 24-hour customer care messages.',
      ],
      liveTiming: 'Applied immediately to every new notification job dispatched after saving.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Confirm variables populate properly in the Live Rendered Preview box (no stray {{...}} tokens).',
        'Click Send Test to Telegram or Send Test to Discord to inspect the live formatted message.',
      ],
      commonIssues: [
        {
          symptom: 'A variable disappeared in preview',
          fix: 'Each event only supports its own data fields (for example, {{ticket_id}} only applies to Support Escalation events). Click one of the listed variable chips for the selected event.',
        },
      ],
    },
  },

  notification_history_dlq: {
    key: 'notification_history_dlq',
    title: 'Notification Queue, Delivery Logs & Dead-Letter Retry',
    subtitle: 'Inspect every queued, sent, retrying, or failed alert and retry dead-letter jobs safely.',
    howToUse: {
      whatItDoes:
        'Provides full observability over the durable Firestore notification queue (`notification_jobs` & `notification_logs`). Failed jobs retry with exponential backoff before moving to the Dead-Letter Queue (DLQ) for manual inspection and one-click retry.',
      whenToUse:
        'Check whenever the Dead Letter counter is above 0, after fixing a broken webhook/token, or when manually triggering a Daily Summary.',
      steps: [
        'Use Channel, Status, and Event filters to inspect specific alerts.',
        'If a job is in dead_letter or failed_retrying, read the sanitized error message under the summary.',
        'Fix the underlying credential or channel issue, then click Retry beside that job.',
        'Use Process Queue to flush due retry jobs immediately, or Send Daily Summary to push today’s KPI digest.',
      ],
    },
    frontendImpact: {
      summary: 'Retrying a WhatsApp job may deliver a previously failed customer notification; admin retries deliver to Telegram/Discord.',
      affectedAreas: ['Notification delivery queue and audit trail.'],
      liveTiming: 'Manual retries and queue processing execute immediately.',
    },
    testAndTroubleshoot: {
      howToVerify: [
        'Click Test Alert and verify a new SYSTEM_ERROR job appears in the table with status "sent" (if Telegram/Discord are configured).',
      ],
      commonIssues: [
        {
          symptom: 'Jobs keep landing in dead_letter',
          fix: 'Read the red error line on the job row, then run Diagnostics & Tests for that provider to resolve credential or permission issues.',
        },
      ],
    },
  },

  diagnostics_suite: {
    key: 'diagnostics_suite',
    title: 'Backend Diagnostics & Feature Testing Suite',
    subtitle: 'Verify database, AI, notifications, payments, couriers, and storefront health in one place.',
    howToUse: {
      whatItDoes:
        'Runs safe, honest server-side verification checks across every real backend subsystem in Deshi Gee — clearly reporting Success, Failed, or Not Configured along with what was tested and step-by-step troubleshooting guidance.',
      whenToUse:
        'Run after initial deployment, after rotating any API key/secret, or whenever a feature behaves unexpectedly.',
      steps: [
        'Click Run All Safe Checks to test Firestore, Gemini AI, Meta, Payments, Couriers, Email, SMS, and Storefront Display at once.',
        'Use individual Test buttons to send live pings to Telegram, Discord, WhatsApp, or Resend Email.',
        'Expand any Failed or Not Configured result to view Possible Reasons and exact Troubleshooting Steps.',
      ],
      notes: [
        'Safe diagnostics never invent fake passes, never create fake monetary charges, never book real courier parcels, and never waste SMS credits automatically.',
      ],
    },
    frontendImpact: {
      summary: 'Diagnostic checks are safe and read-only (except explicit test ping/email buttons that message your admin channels).',
      affectedAreas: ['No storefront settings or customer orders are altered by diagnostics.'],
      liveTiming: 'Results reflect live server state at the exact timestamp shown.',
    },
    testAndTroubleshoot: {
      howToVerify: ['Click Run All Safe Checks and inspect each card’s timestamp and status.'],
      commonIssues: [
        {
          symptom: 'Firestore Admin SDK check fails in AI Studio preview',
          fix: 'Expected when preview lacks GCP IAM binding. Deploy to Cloud Run with roles/datastore.user to enable full server persistence.',
        },
      ],
    },
  },
};
