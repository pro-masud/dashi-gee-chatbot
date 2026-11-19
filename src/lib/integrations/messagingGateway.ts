import { normalizeBangladeshPhone } from '../chatbot/orderToken';
import type { NotificationAttemptLog } from '../serverState';

export interface MessagingGatewayReadiness {
  bulksmsbd: boolean;
  twilioSms: boolean;
  resendEmail: boolean;
  anyDirectSms: boolean;
  anyDirectEmail: boolean;
}

export function getMessagingGatewayReadiness(): MessagingGatewayReadiness {
  const bulksmsbd =
    (process.env.BULKSMSBD_API_KEY || '').trim().length >= 6 &&
    (process.env.BULKSMSBD_SENDER_ID || '').trim().length >= 2;
  const twilioSms =
    (process.env.TWILIO_ACCOUNT_SID || '').trim().startsWith('AC') &&
    (process.env.TWILIO_AUTH_TOKEN || '').trim().length >= 10 &&
    (process.env.TWILIO_FROM_NUMBER || '').trim().length >= 6;
  const resendEmail =
    (process.env.RESEND_API_KEY || '').trim().length >= 8 &&
    (process.env.RESEND_FROM_EMAIL || '').trim().includes('@');

  return {
    bulksmsbd,
    twilioSms,
    resendEmail,
    anyDirectSms: bulksmsbd || twilioSms,
    anyDirectEmail: resendEmail,
  };
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sanitizeGatewayDetail(raw: string): string {
  return String(raw || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s&,"']+/gi, '$1=[redacted]')
    .slice(0, 140);
}

export async function sendDirectSms(params: {
  toPhone: string;
  message: string;
  orderNumber?: string;
}): Promise<NotificationAttemptLog> {
  const timestamp = new Date().toISOString();
  const orderNumber = String(params.orderNumber || '');
  const cleanPhone = normalizeBangladeshPhone(params.toPhone);
  const text = String(params.message || '').trim().slice(0, 480);

  if (!/^01[3-9]\d{8}$/.test(cleanPhone) || !text) {
    return {
      orderNumber,
      channel: 'direct_sms',
      status: 'failed',
      detail: 'Invalid Bangladesh phone number or empty SMS text.',
      timestamp,
    };
  }

  const readiness = getMessagingGatewayReadiness();

  if (readiness.bulksmsbd) {
    // S0-12: Send BulkSMSBD credentials in POST form body (never in GET query URL) and never log URLs/keys.
    const recipient = `88${cleanPhone}`;
    const formBody = new URLSearchParams({
      api_key: (process.env.BULKSMSBD_API_KEY || '').trim(),
      type: 'text',
      number: recipient,
      senderid: (process.env.BULKSMSBD_SENDER_ID || '').trim(),
      message: text,
    });
    try {
      const res = await fetch('https://bulksmsbd.net/api/smsapi', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      });
      const bodyText = await res.text().catch(() => '');
      const ok = res.ok && !/error|invalid|100[1-9]|101\d/i.test(bodyText);
      return {
        orderNumber,
        channel: 'bulksmsbd',
        status: ok ? 'sent' : 'failed',
        detail: ok
          ? `BulkSMSBD delivered to ${recipient}`
          : `BulkSMSBD HTTP ${res.status}: ${sanitizeGatewayDetail(bodyText)}`,
        timestamp,
      };
    } catch (err) {
      return {
        orderNumber,
        channel: 'bulksmsbd',
        status: 'failed',
        detail: sanitizeGatewayDetail(
          err instanceof Error ? err.message : 'BulkSMSBD network error'
        ),
        timestamp,
      };
    }
  }

  if (readiness.twilioSms) {
    const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const from = (process.env.TWILIO_FROM_NUMBER || '').trim();
    const to = `+88${cleanPhone}`;
    const form = new URLSearchParams({ To: to, From: from, Body: text });
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');

    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        }
      );
      if (res.ok) {
        return {
          orderNumber,
          channel: 'twilio_sms',
          status: 'sent',
          detail: `Twilio SMS sent to ${to}`,
          timestamp,
        };
      }
      const errBody = await res.text().catch(() => '');
      return {
        orderNumber,
        channel: 'twilio_sms',
        status: 'failed',
        detail: `Twilio HTTP ${res.status}: ${errBody.slice(0, 120)}`,
        timestamp,
      };
    } catch (err) {
      return {
        orderNumber,
        channel: 'twilio_sms',
        status: 'failed',
        detail: err instanceof Error ? err.message : 'Twilio network error',
        timestamp,
      };
    }
  }

  return {
    orderNumber,
    channel: 'direct_sms',
    status: 'skipped_unconfigured',
    detail: 'Neither BulkSMSBD nor Twilio SMS is configured.',
    timestamp,
  };
}

export async function sendDirectEmail(params: {
  toEmail: string;
  subject: string;
  text: string;
  orderNumber?: string;
}): Promise<NotificationAttemptLog> {
  const timestamp = new Date().toISOString();
  const orderNumber = String(params.orderNumber || '');
  const to = String(params.toEmail || '').trim();
  const readiness = getMessagingGatewayReadiness();

  if (!readiness.resendEmail) {
    return {
      orderNumber,
      channel: 'resend_email',
      status: 'skipped_unconfigured',
      detail: 'Resend email credentials (RESEND_API_KEY / RESEND_FROM_EMAIL) are not configured.',
      timestamp,
    };
  }

  if (!to || !to.includes('@')) {
    return {
      orderNumber,
      channel: 'resend_email',
      status: 'failed',
      detail: 'Missing or invalid recipient email address.',
      timestamp,
    };
  }

  const subject = String(params.subject || 'Deshi Gee Notification').trim().slice(0, 160);
  const textBody = String(params.text || '').trim().slice(0, 4000);
  const htmlBody = `<div style="font-family:sans-serif;color:#1E1710;line-height:1.6">${escapeHtml(
    textBody
  ).replace(/\n/g, '<br/>')}</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${(process.env.RESEND_API_KEY || '').trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: (process.env.RESEND_FROM_EMAIL || '').trim(),
        to: [to],
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });
    if (res.ok) {
      return {
        orderNumber,
        channel: 'resend_email',
        status: 'sent',
        detail: `Resend email sent to ${to}`,
        timestamp,
      };
    }
    const errText = await res.text().catch(() => '');
    return {
      orderNumber,
      channel: 'resend_email',
      status: 'failed',
      detail: `Resend HTTP ${res.status}: ${errText.slice(0, 120)}`,
      timestamp,
    };
  } catch (err) {
    return {
      orderNumber,
      channel: 'resend_email',
      status: 'failed',
      detail: err instanceof Error ? err.message : 'Resend network error',
      timestamp,
    };
  }
}
