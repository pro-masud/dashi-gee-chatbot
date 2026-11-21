'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Sparkles,
} from 'lucide-react';
import {
  BUSINESS_EVENT_TYPES,
  DEFAULT_EVENT_TEMPLATES,
  EVENT_SUPPORTED_VARIABLES,
  isCustomerCapableEvent,
  renderNotificationTemplate,
  SAMPLE_EVENT_PAYLOADS,
  type BusinessEventType,
  type NotificationRecipientScope,
  type NotificationRulesDoc,
  type NotificationTemplateOverride,
} from '../../lib/notifications/types';
import { HelpInfoButton } from './AdminHelpModal';

const EVENT_LABELS: Record<BusinessEventType, string> = {
  ORDER_CREATED: 'New Order Created',
  ORDER_UPDATED: 'Order Updated / Shipped',
  ORDER_CANCELLED: 'Order Cancelled',
  PAYMENT_SUCCESS: 'Payment Verified',
  PAYMENT_FAILED: 'Payment Failed / Cancelled',
  SUPPORT_REQUESTED: 'Support Escalation Ticket',
  CUSTOMER_MESSAGE_RECEIVED: 'Inbound Customer Message',
  LOW_STOCK: 'Low Inventory Alert',
  DAILY_SUMMARY: 'Daily Operations Summary',
  SYSTEM_ERROR: 'System Error / Test Alert',
};

type TemplateFieldKey =
  | 'titleTemplate'
  | 'bodyTemplate'
  | 'emailSubjectTemplate'
  | 'whatsappMessageTemplate';

interface NotificationTemplatesEditorProps {
  rules: NotificationRulesDoc;
  saving: boolean;
  getIdToken: () => Promise<string>;
  onChangeRules: (updater: (prev: NotificationRulesDoc) => NotificationRulesDoc) => void;
  onSaveRules: (nextRules: NotificationRulesDoc) => Promise<void>;
  onFeedback: (kind: 'success' | 'error' | 'info', text: string) => void;
}

export function NotificationTemplatesEditor({
  rules,
  saving,
  getIdToken,
  onChangeRules,
  onSaveRules,
  onFeedback,
}: NotificationTemplatesEditorProps) {
  const [selectedEvent, setSelectedEvent] = useState<BusinessEventType>('ORDER_CREATED');
  const [activeField, setActiveField] = useState<TemplateFieldKey>('bodyTemplate');
  const [testingChannel, setTestingChannel] = useState<'telegram' | 'discord' | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const canTargetCustomer = isCustomerCapableEvent(selectedEvent);
  const defaultTpl = DEFAULT_EVENT_TEMPLATES[selectedEvent];
  const savedOverride = rules.templates?.[selectedEvent] || {};

  const currentTpl: Required<NotificationTemplateOverride> = {
    titleTemplate: savedOverride.titleTemplate ?? defaultTpl.titleTemplate,
    bodyTemplate: savedOverride.bodyTemplate ?? defaultTpl.bodyTemplate,
    emailSubjectTemplate: savedOverride.emailSubjectTemplate ?? defaultTpl.emailSubjectTemplate,
    whatsappMessageTemplate:
      savedOverride.whatsappMessageTemplate ?? defaultTpl.whatsappMessageTemplate,
    recipientScope: savedOverride.recipientScope ?? defaultTpl.recipientScope,
  };

  const supportedVars = EVENT_SUPPORTED_VARIABLES[selectedEvent] || [];
  const sampleEvent = SAMPLE_EVENT_PAYLOADS[selectedEvent];

  const isCustomized = Boolean(
    savedOverride.titleTemplate ||
      savedOverride.bodyTemplate ||
      savedOverride.emailSubjectTemplate ||
      savedOverride.whatsappMessageTemplate ||
      savedOverride.recipientScope
  );

  const preview = useMemo(() => {
    return {
      title: renderNotificationTemplate(currentTpl.titleTemplate, sampleEvent, { maskPhone: true }),
      body: renderNotificationTemplate(currentTpl.bodyTemplate, sampleEvent, { maskPhone: true }),
      emailSubject: renderNotificationTemplate(currentTpl.emailSubjectTemplate, sampleEvent, {
        maskPhone: true,
      }),
      whatsapp: renderNotificationTemplate(currentTpl.whatsappMessageTemplate, sampleEvent, {
        maskPhone: false,
      }),
    };
  }, [
    currentTpl.titleTemplate,
    currentTpl.bodyTemplate,
    currentTpl.emailSubjectTemplate,
    currentTpl.whatsappMessageTemplate,
    sampleEvent,
  ]);

  const updateTemplateField = (patch: Partial<NotificationTemplateOverride>) => {
    onChangeRules((prev) => ({
      ...prev,
      templates: {
        ...(prev.templates || {}),
        [selectedEvent]: {
          ...(prev.templates?.[selectedEvent] || {}),
          ...patch,
        },
      },
    }));
  };

  const handleInsertVariable = (varKey: string) => {
    const token = `{{${varKey}}}`;
    const existingVal = currentTpl[activeField] || '';
    const nextVal = existingVal ? `${existingVal} ${token}` : token;
    updateTemplateField({ [activeField]: nextVal });
  };

  const handleResetEvent = () => {
    onChangeRules((prev) => {
      const nextTemplates = { ...(prev.templates || {}) };
      delete nextTemplates[selectedEvent];
      return { ...prev, templates: nextTemplates };
    });
    setConfirmingReset(false);
    onFeedback(
      'info',
      `Reset ${EVENT_LABELS[selectedEvent]} template draft to built-in default (prices, stock & contacts untouched). Click Save Templates to persist.`
    );
  };

  const handleSendLiveTest = async (channel: 'telegram' | 'discord') => {
    setTestingChannel(channel);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider: 'template_test',
          eventType: selectedEvent,
          channel,
          templateOverride: currentTpl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        onFeedback(
          'success',
          `Live sample ${EVENT_LABELS[selectedEvent]} template sent to ${channel.toUpperCase()}.`
        );
      } else {
        onFeedback(
          res.status === 503 ? 'info' : 'error',
          data.error || `Template test via ${channel} failed (HTTP ${res.status}).`
        );
      }
    } finally {
      setTestingChannel(null);
    }
  };

  return (
    <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-[rgba(30,23,16,0.10)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#8A5A17]" />
            <h3 className="font-display text-lg font-semibold text-[#1E1710]">
              Message Templates, Variables &amp; Live Preview
            </h3>
            <HelpInfoButton section="notification_templates" />
          </div>
          <p className="mt-0.5 text-xs text-[#635647]">
            Customize wording per event · Only supported dynamic variables are shown · Live preview
            uses realistic sample data
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Select business event template"
            value={selectedEvent}
            onChange={(e) => {
              setSelectedEvent(e.target.value as BusinessEventType);
              setConfirmingReset(false);
            }}
            className="min-h-[38px] rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-1.5 text-xs font-medium text-[#1E1710] focus:border-[#B47B2B] focus:outline-none"
          >
            {BUSINESS_EVENT_TYPES.map((evt) => (
              <option key={evt} value={evt}>
                {EVENT_LABELS[evt]}
              </option>
            ))}
          </select>
          <span className="font-mono text-[11px] text-[#635647]">
            {isCustomized ? 'Custom override active' : 'Using built-in default'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Template Editor Controls */}
        <div className="space-y-4 lg:col-span-7">
          {/* Recipient Scope */}
          <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-3.5">
            <p className="text-xs font-semibold text-[#1E1710]">Recipient Targeting</p>
            <p className="mt-0.5 text-[11px] text-[#635647]">
              {canTargetCustomer
                ? 'Customer WhatsApp messages require verified opt-in (or active 24h window) and are held during Dhaka quiet hours (22:00–08:00 BST). Test sends always go to Admin channels only.'
                : 'This internal operational event is locked to Admin Alerts Only and never messages customers.'}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {(
                (canTargetCustomer
                  ? [
                      ['admin', 'Admin Alerts Only'],
                      ['customer', 'Customer Only (Opt-In WhatsApp)'],
                      ['both', 'Both Admin & Customer'],
                    ]
                  : [['admin', 'Admin Alerts Only (Locked)']]) as Array<
                  [NotificationRecipientScope, string]
                >
              ).map(([scope, label]) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => updateTemplateField({ recipientScope: scope })}
                  className={`min-h-[34px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    (canTargetCustomer ? currentTpl.recipientScope : 'admin') === scope
                      ? 'bg-[#1E1710] text-[#FAF7F2]'
                      : 'border border-[rgba(30,23,16,0.14)] bg-[#FFFDF9] text-[#635647] hover:text-[#1E1710]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Clickable Supported Variables Bar */}
          <div>
            <p className="text-xs font-medium text-[#1E1710]">
              Insert Dynamic Variable into active field (
              <span className="font-mono text-[#8A5A17]">{activeField}</span>):
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {supportedVars.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => handleInsertVariable(v.key)}
                  title={`${v.label} — Sample: ${v.sample}`}
                  className="inline-flex min-h-[28px] items-center rounded-md border border-[rgba(30,23,16,0.16)] bg-[#FAF7F2] px-2 py-1 font-mono text-[11px] text-[#1E1710] hover:border-[#B47B2B] hover:bg-[#F2ECE1]"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Title Template */}
          <div>
            <label className="block text-xs font-medium text-[#1E1710]">
              Alert Title (Telegram &amp; Discord Heading)
            </label>
            <input
              type="text"
              value={currentTpl.titleTemplate}
              onFocus={() => setActiveField('titleTemplate')}
              onChange={(e) => updateTemplateField({ titleTemplate: e.target.value })}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 text-xs focus:border-[#B47B2B] focus:outline-none"
            />
          </div>

          {/* Body Template */}
          <div>
            <label className="block text-xs font-medium text-[#1E1710]">
              Message Body (Telegram &amp; Discord Description)
            </label>
            <textarea
              rows={3}
              value={currentTpl.bodyTemplate}
              onFocus={() => setActiveField('bodyTemplate')}
              onChange={(e) => updateTemplateField({ bodyTemplate: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 text-xs focus:border-[#B47B2B] focus:outline-none"
            />
          </div>

          {/* Email Subject + WhatsApp 24h Message */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-[#1E1710]">
                Email Subject Line
              </label>
              <input
                type="text"
                value={currentTpl.emailSubjectTemplate}
                onFocus={() => setActiveField('emailSubjectTemplate')}
                onChange={(e) => updateTemplateField({ emailSubjectTemplate: e.target.value })}
                className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 text-xs focus:border-[#B47B2B] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#1E1710]">
                WhatsApp Message (24h Window Text)
              </label>
              <input
                type="text"
                value={currentTpl.whatsappMessageTemplate}
                onFocus={() => setActiveField('whatsappMessageTemplate')}
                onChange={(e) => updateTemplateField({ whatsappMessageTemplate: e.target.value })}
                className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 text-xs focus:border-[#B47B2B] focus:outline-none"
              />
            </div>
          </div>

          {/* Save & Reset Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSaveRules(rules)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-4 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>Save Templates &amp; Rules</span>
            </button>

            {!confirmingReset ? (
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3.5 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Event to Default</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <span>
                  Reset <strong>{EVENT_LABELS[selectedEvent]}</strong> template only? (Never touches
                  prices, stock, or contacts.)
                </span>
                <button
                  type="button"
                  onClick={handleResetEvent}
                  className="rounded-md bg-[#1E1710] px-2.5 py-1 text-[11px] font-medium text-[#FAF7F2] hover:bg-[#35291E]"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-950 hover:bg-amber-100"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Live Rendered Preview & Send Live Test */}
        <div className="space-y-4 rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] p-4 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1E1710]">
              <Eye className="h-3.5 w-3.5 text-[#8A5A17]" />
              <span>Live Message Preview</span>
            </p>
            <span className="font-mono text-[10px] uppercase text-[#635647]">
              Sample {selectedEvent}
            </span>
          </div>

          {/* Telegram / Discord Preview Card */}
          <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-3.5 text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8A5A17]">
              Admin Alert (Telegram &amp; Discord)
            </p>
            <p className="mt-1.5 font-semibold text-[#1E1710]">{preview.title || '(Empty title)'}</p>
            <p className="mt-1 whitespace-pre-wrap text-[#635647]">
              {preview.body || '(Empty message body)'}
            </p>
          </div>

          {/* Email Subject Preview */}
          <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-3.5 text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8A5A17]">
              Email Subject Preview
            </p>
            <p className="mt-1 font-medium text-[#1E1710]">{preview.emailSubject}</p>
          </div>

          {/* WhatsApp Preview */}
          <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-3.5 text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
              Customer WhatsApp (24h Window Preview)
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[#1E1710]">{preview.whatsapp}</p>
          </div>

          {/* Live Test Buttons */}
          <div className="border-t border-[rgba(30,23,16,0.10)] pt-3">
            <p className="text-[11px] font-medium text-[#635647]">
              Send this exact preview to a connected admin channel:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={testingChannel !== null}
                onClick={() => void handleSendLiveTest('telegram')}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
              >
                {testingChannel === 'telegram' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                <span>Send Test to Telegram</span>
              </button>

              <button
                type="button"
                disabled={testingChannel !== null}
                onClick={() => void handleSendLiveTest('discord')}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
              >
                {testingChannel === 'discord' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#8A5A17]" />
                )}
                <span>Send Test to Discord</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
