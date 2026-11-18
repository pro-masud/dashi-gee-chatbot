import { NextResponse } from 'next/server';
import {
  fetchAdminSupportEvidence,
  fetchAdminSupportTickets,
  postAdminAgentReply,
  setAdminSessionAiPause,
  updateAdminSupportTicket,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { buildRuntimeHealthReport } from '../../../../src/lib/chatbot/runtimeHealth';
import { getTodayBstDateKey } from '../../../../src/lib/chatbot/security';
import type { SupportPriority, SupportTicketStatus } from '../../../../src/lib/chatbot/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const adminCheck = await verifyServerAdminToken(request.headers.get('authorization'));
  if (!adminCheck.ok) {
    return Response.json({ error: 'Unauthorized admin request.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const bypassCache = url.searchParams.get('refresh') === '1';
  const health = await buildRuntimeHealthReport({ bypassCache });

  return Response.json(
    {
      ok: true,
      adminEmail: adminCheck.email,
      geminiConfigured: health.checks.geminiApiKeyOk,
      model: health.checks.primaryModel.name,
      fallbackModel: health.checks.fallbackModel.name,
      activePath: health.activePath,
      health,
      bstDate: getTodayBstDateKey(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

async function handleInboxAction(request: Request) {
  const authHeader = request.headers.get('authorization');
  const adminCheck = await verifyServerAdminToken(authHeader);
  if (!adminCheck.ok) {
    return NextResponse.json({ ok: false, error: 'Unauthorized admin request.' }, { status: 401 });
  }
  const idToken = authHeader ? authHeader.slice(7).trim() : '';
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();

  if (action === 'list_tickets') {
    const tickets = await fetchAdminSupportTickets(idToken);
    return NextResponse.json({ ok: true, tickets }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (action === 'claim_ticket') {
    const ticketId = String(body.ticketId || '').trim();
    const assignedTo = String(body.assignedTo || adminCheck.email || 'Admin').trim();
    const sessionId = String(body.sessionId || '').trim();
    const agentName = String(body.agentName || 'Deshi Gee Support').trim();

    const updated = await updateAdminSupportTicket({
      ticketId,
      assignedTo,
      status: (body.status as SupportTicketStatus) || 'contacted',
      adminIdToken: idToken,
      actorEmail: adminCheck.email,
    });

    if (!updated.ok) {
      return NextResponse.json({ ok: false, error: updated.error || 'Claim failed' }, { status: 400 });
    }

    const effectiveSessionId = sessionId || updated.ticket?.sessionId || '';
    if (effectiveSessionId && /^[a-zA-Z0-9_-]{4,64}$/.test(effectiveSessionId)) {
      await setAdminSessionAiPause({
        sessionId: effectiveSessionId,
        aiPaused: true,
        ticketId,
        agentName,
        adminIdToken: idToken,
      });
    }

    return NextResponse.json(
      { ok: true, ticket: updated.ticket, aiPaused: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (action === 'update_ticket') {
    const ticketId = String(body.ticketId || '').trim();
    const updated = await updateAdminSupportTicket({
      ticketId,
      status: body.status as SupportTicketStatus | undefined,
      priority: body.priority as SupportPriority | undefined,
      assignedTo: typeof body.assignedTo === 'string' ? body.assignedTo : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      resolutionReason: typeof body.resolutionReason === 'string' ? body.resolutionReason : undefined,
      internalNotes: typeof body.internalNotes === 'string' ? body.internalNotes : undefined,
      resumeAiOnResolve: body.resumeAiOnResolve !== false,
      adminIdToken: idToken,
      actorEmail: adminCheck.email,
    });
    return NextResponse.json(updated, {
      status: updated.ok ? 200 : 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (action === 'reply_chat') {
    const res = await postAdminAgentReply({
      ticketId: String(body.ticketId || ''),
      sessionId: String(body.sessionId || ''),
      agentEmail: adminCheck.email,
      agentName: String(body.agentName || 'Deshi Gee Support'),
      text: String(body.text || ''),
      adminIdToken: idToken,
    });
    return NextResponse.json(res, {
      status: res.ok ? 200 : 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (action === 'toggle_ai_pause') {
    const res = await setAdminSessionAiPause({
      sessionId: String(body.sessionId || ''),
      aiPaused: Boolean(body.aiPaused),
      ticketId: typeof body.ticketId === 'string' ? body.ticketId : undefined,
      agentName: typeof body.agentName === 'string' ? body.agentName : undefined,
      adminIdToken: idToken,
    });
    return NextResponse.json(res, {
      status: res.ok ? 200 : 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (action === 'get_evidence') {
    const evidenceId = String(body.evidenceId || '').trim();
    const evidence = await fetchAdminSupportEvidence(evidenceId, idToken);
    if (!evidence) {
      return NextResponse.json({ ok: false, error: 'Evidence not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, evidence }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ ok: false, error: 'Unsupported admin action.' }, { status: 400 });
}

export async function POST(request: Request) {
  return handleInboxAction(request);
}

export async function PATCH(request: Request) {
  return handleInboxAction(request);
}

