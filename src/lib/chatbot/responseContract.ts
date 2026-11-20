import type {
  ChatActionItem,
  KnowledgeSourceRef,
  OrderManageProposalCard,
  OrderSummaryCard,
  ProductCardItem,
  TrackingCardData,
} from './types';

export type OrderDraftContractStatus =
  | 'none'
  | 'collecting'
  | 'ready_to_confirm'
  | 'manage_proposal';

/**
 * T1.6: Structured chat turn response contract.
 * Authoritative monetary totals, order IDs, and order statuses come strictly
 * from backend-verified card/tool payloads — never from untrusted LLM text.
 */
export interface StructuredChatTurnContract {
  replyText: string;
  intent: string;
  confidence: number;
  needsHuman: boolean;
  sources: { id: string; title: string; category: string }[];
  suggestedReplies: string[];
  productCardIds: string[];
  orderDraftStatus: OrderDraftContractStatus;
  actions: ChatActionItem[];
  verifiedOrderId: string | null;
  verifiedTotalBdt: number | null;
  verifiedOrderStatus: string | null;
}

export function buildStructuredChatTurnContract(params: {
  replyText: string;
  intent?: string;
  confidence?: number;
  needsHuman?: boolean;
  sources?: KnowledgeSourceRef[];
  suggestedReplies?: string[];
  productCards?: ProductCardItem[];
  orderSummary?: OrderSummaryCard | null;
  orderManageProposal?: OrderManageProposalCard | null;
  trackingCard?: TrackingCardData | null;
  actions?: ChatActionItem[];
}): StructuredChatTurnContract {
  const orderDraftStatus: OrderDraftContractStatus = params.orderManageProposal
    ? 'manage_proposal'
    : params.orderSummary
      ? 'ready_to_confirm'
      : params.intent === 'order'
        ? 'collecting'
        : 'none';

  const actions = params.actions || [];
  const needsHuman =
    Boolean(params.needsHuman) ||
    actions.some((a) => a.type === 'whatsapp' || a.type === 'call');

  return {
    replyText: String(params.replyText || ''),
    intent: String(params.intent || 'general'),
    confidence:
      typeof params.confidence === 'number' && Number.isFinite(params.confidence)
        ? Math.max(0, Math.min(1, Number(params.confidence.toFixed(2))))
        : 0.85,
    needsHuman,
    sources: (params.sources || []).map((s) => ({
      id: s.id,
      title: s.title,
      category: s.category,
    })),
    suggestedReplies: (params.suggestedReplies || []).slice(0, 6),
    productCardIds: (params.productCards || []).map((p) => p.weight),
    orderDraftStatus,
    actions,
    // Backend-only verified money / orderId / status projection
    verifiedOrderId:
      params.trackingCard?.orderNumber ||
      params.orderManageProposal?.orderNumber ||
      null,
    verifiedTotalBdt:
      typeof params.orderSummary?.totalBdt === 'number'
        ? params.orderSummary.totalBdt
        : typeof params.trackingCard?.totalBdt === 'number'
          ? params.trackingCard.totalBdt
          : null,
    verifiedOrderStatus: params.trackingCard?.status || null,
  };
}
