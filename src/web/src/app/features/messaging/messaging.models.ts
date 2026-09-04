import type {
  ConversationDetail as ContractConversationDetail,
  ConversationMessagePreview as ContractPreview,
  ConversationPage as ContractConversationPage,
  ConversationParticipantRole,
  ConversationReadState as ContractReadState,
  ConversationSummary as ContractConversationSummary,
  FeatureAccessReason,
  MessageDeletionKind,
  MessageDeliveryState,
  MessagePage as ContractMessagePage,
  MessageView as ContractMessageView,
  MessagingRealtimeEventKind,
  MessagingUnreadCount as ContractUnreadCount,
  RealtimeAcknowledgementResult as ContractAcknowledgementResult,
  RealtimeEventPage as ContractRealtimeEventPage,
  RealtimeEventView as ContractRealtimeEventView,
} from '../../core/api/generated';

/**
 * Angular-owned view models for messaging.
 *
 * The generated contracts type every 64-bit number as `number | string`, so a component reading them
 * directly ends up comparing a string sequence against a number and paging to the wrong place.
 * Mapping once, here, keeps that conversion in one spot and keeps the screen's vocabulary stable if
 * the transport shape changes.
 *
 * Nothing here interprets a message body. It travels as a string and is rendered by ordinary text
 * interpolation, never as HTML.
 */
export interface MessagePreview {
  readonly messageId: string;
  readonly sequence: number;
  readonly senderUserId: string;
  readonly isFromCaller: boolean;
  readonly sentAtUtc: string;
  readonly body: string | null;
  readonly isDeleted: boolean;
  readonly deletionKind: MessageDeletionKind | null;
}

export interface ConversationCounterpart {
  readonly userId: string;
  readonly displayName: string;
  readonly role: ConversationParticipantRole;
}

export interface Conversation {
  readonly id: string;
  readonly clientProfileId: string;
  readonly counterpart: ConversationCounterpart;
  readonly callerRole: ConversationParticipantRole;
  readonly canModerate: boolean;
  readonly startedAtUtc: string;
  readonly lastActivityAtUtc: string;
  readonly lastSequence: number;
  readonly unreadCount: number;
  readonly lastReadSequence: number;
  readonly lastReadAtUtc: string | null;
  readonly isAvailable: boolean;
  readonly accessReason: FeatureAccessReason;
  readonly lastMessage: MessagePreview | null;
}

export interface ConversationPage {
  readonly items: readonly Conversation[];
  readonly hasMore: boolean;
  readonly nextBeforeActivityAtUtc: string | null;
  readonly nextBeforeConversationId: string | null;
}

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly sequence: number;
  readonly senderUserId: string;
  readonly isFromCaller: boolean;
  readonly sentAtUtc: string;
  readonly availableAtUtc: string;
  readonly editedAtUtc: string | null;
  readonly revisionNumber: number;
  readonly body: string | null;
  readonly isDeleted: boolean;
  readonly deletionKind: MessageDeletionKind | null;
  readonly deletedAtUtc: string | null;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canModerate: boolean;
  readonly isUnreadByCaller: boolean;
  readonly version: number;
  /**
   * `Persisted`, or `RealtimeAcknowledged` once the other participant's application accepted an
   * event about this message. Neither says a person read it, and neither is ever rendered as
   * "delivered" or "seen".
   */
  readonly deliveryState: MessageDeliveryState;
}

/**
 * One realtime event as this participant is allowed to see it.
 *
 * Identical whether it arrived over the socket or through catch-up, so the merge rule is written
 * once. `message` is the server's current safe projection, so a removed message arrives as its
 * tombstone with no body, and a moderation reason is never present at all.
 */
export interface RealtimeEvent {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly eventId: string;
  readonly eventSequence: number;
  readonly kind: MessagingRealtimeEventKind;
  readonly occurredAtUtc: string;
  readonly message: Message | null;
}

export interface RealtimeEventPage {
  readonly conversationId: string;
  readonly items: readonly RealtimeEvent[];
  readonly hasMore: boolean;
  readonly nextAfterEventSequence: number | null;
  readonly latestEventSequence: number;
}

export interface RealtimeAcknowledgement {
  readonly conversationId: string;
  readonly accepted: number;
  readonly alreadyAcknowledged: number;
  readonly latestEventSequence: number;
}

export interface ConversationReadState {
  readonly conversationId: string;
  readonly userId: string;
  readonly role: ConversationParticipantRole;
  readonly lastReadSequence: number;
  readonly lastReadAtUtc: string | null;
  readonly unreadCount: number;
  readonly latestSequence: number;
}

export interface MessagePage {
  readonly conversationId: string;
  readonly items: readonly Message[];
  readonly hasOlder: boolean;
  readonly oldestSequence: number | null;
  readonly latestSequence: number;
  /**
   * The realtime watermark this read established. Zero for a conversation that predates realtime
   * events, which is honest: it has none, and this read is what established its current state.
   */
  readonly latestEventSequence: number;
  readonly readState: ConversationReadState;
}

export interface ConversationDetail {
  readonly conversation: Conversation;
  readonly readState: ConversationReadState;
}

export function mapPreview(value: ContractPreview): MessagePreview {
  return {
    messageId: value.messageId,
    sequence: toCount(value.sequence),
    senderUserId: value.senderUserId,
    isFromCaller: value.isFromCaller,
    sentAtUtc: value.sentAtUtc,
    body: value.body ?? null,
    isDeleted: value.isDeleted,
    deletionKind: value.deletionKind ?? null,
  };
}

export function mapConversation(value: ContractConversationSummary): Conversation {
  return {
    id: value.id,
    clientProfileId: value.clientProfileId,
    counterpart: {
      userId: value.counterpart.userId,
      displayName: value.counterpart.displayName,
      role: value.counterpart.role,
    },
    callerRole: value.callerRole,
    canModerate: value.canModerate,
    startedAtUtc: value.startedAtUtc,
    lastActivityAtUtc: value.lastActivityAtUtc,
    lastSequence: toCount(value.lastSequence),
    unreadCount: toCount(value.unreadCount),
    lastReadSequence: toCount(value.lastReadSequence),
    lastReadAtUtc: value.lastReadAtUtc ?? null,
    isAvailable: value.isAvailable,
    accessReason: value.accessReason,
    lastMessage: value.lastMessage ? mapPreview(value.lastMessage) : null,
  };
}

export function mapConversationPage(value: ContractConversationPage): ConversationPage {
  return {
    items: value.items.map(mapConversation),
    hasMore: value.hasMore,
    nextBeforeActivityAtUtc: value.nextBeforeActivityAtUtc ?? null,
    nextBeforeConversationId: value.nextBeforeConversationId ?? null,
  };
}

export function mapMessage(value: ContractMessageView): Message {
  return {
    id: value.id,
    conversationId: value.conversationId,
    sequence: toCount(value.sequence),
    senderUserId: value.senderUserId,
    isFromCaller: value.isFromCaller,
    sentAtUtc: value.sentAtUtc,
    availableAtUtc: value.availableAtUtc,
    editedAtUtc: value.editedAtUtc ?? null,
    revisionNumber: toCount(value.revisionNumber),
    body: value.body ?? null,
    isDeleted: value.isDeleted,
    deletionKind: value.deletionKind ?? null,
    deletedAtUtc: value.deletedAtUtc ?? null,
    canEdit: value.canEdit,
    canDelete: value.canDelete,
    canModerate: value.canModerate,
    isUnreadByCaller: value.isUnreadByCaller,
    version: toCount(value.version),
    deliveryState: value.deliveryState,
  };
}

export function mapRealtimeEvent(value: ContractRealtimeEventView): RealtimeEvent {
  return {
    tenantId: value.tenantId,
    conversationId: value.conversationId,
    eventId: value.eventId,
    eventSequence: toCount(value.eventSequence),
    kind: value.kind,
    occurredAtUtc: value.occurredAtUtc,
    message: value.message ? mapMessage(value.message) : null,
  };
}

export function mapRealtimeEventPage(value: ContractRealtimeEventPage): RealtimeEventPage {
  return {
    conversationId: value.conversationId,
    items: value.items.map(mapRealtimeEvent),
    hasMore: value.hasMore,
    nextAfterEventSequence:
      value.nextAfterEventSequence === null || value.nextAfterEventSequence === undefined
        ? null
        : toCount(value.nextAfterEventSequence),
    latestEventSequence: toCount(value.latestEventSequence),
  };
}

export function mapRealtimeAcknowledgement(
  value: ContractAcknowledgementResult,
): RealtimeAcknowledgement {
  return {
    conversationId: value.conversationId,
    accepted: toCount(value.accepted),
    alreadyAcknowledged: toCount(value.alreadyAcknowledged),
    latestEventSequence: toCount(value.latestEventSequence),
  };
}

/**
 * Whether an incoming projection is newer than the one already held.
 *
 * Delivery is at least once and out of order, so the same message can arrive several times and an
 * older projection can arrive after a newer one — a duplicate after a reclaimed publication, a
 * catch-up page overlapping a live frame, an edit that raced its own event. Identity alone cannot
 * decide which to keep, so the comparison is explicit.
 *
 * Removal is terminal for content. Once a message is known to be removed no earlier projection may
 * put its body back, whatever its revision says, because a body somebody deliberately took back
 * reappearing is worse than a stale timestamp.
 */
export function isNewerProjection(current: Message | undefined, incoming: Message): boolean {
  if (current === undefined) {
    return true;
  }

  if (current.id !== incoming.id || current.conversationId !== incoming.conversationId) {
    return false;
  }

  if (current.isDeleted) {
    return false;
  }

  return incoming.isDeleted || incoming.revisionNumber > current.revisionNumber;
}

export function mapReadState(value: ContractReadState): ConversationReadState {
  return {
    conversationId: value.conversationId,
    userId: value.userId,
    role: value.role,
    lastReadSequence: toCount(value.lastReadSequence),
    lastReadAtUtc: value.lastReadAtUtc ?? null,
    unreadCount: toCount(value.unreadCount),
    latestSequence: toCount(value.latestSequence),
  };
}

export function mapMessagePage(value: ContractMessagePage): MessagePage {
  return {
    conversationId: value.conversationId,
    items: value.items.map(mapMessage),
    hasOlder: value.hasOlder,
    oldestSequence: value.oldestSequence === null ? null : toCount(value.oldestSequence),
    latestSequence: toCount(value.latestSequence),
    latestEventSequence: toCount(value.latestEventSequence),
    readState: mapReadState(value.readState),
  };
}

export function mapConversationDetail(value: ContractConversationDetail): ConversationDetail {
  return {
    conversation: mapConversation(value.conversation),
    readState: mapReadState(value.readState),
  };
}

export function mapMessagingUnreadCount(value: ContractUnreadCount): number {
  return toCount(value.unread);
}

/**
 * Merges an older page into a thread held oldest-first, without letting an identifier appear twice.
 *
 * Two pages can overlap: a message sent between the two requests shifts nothing about which
 * sequences are older than the cursor, but a Refresh in between can re-fetch rows already loaded. A
 * duplicated `@for` key is a rendering error rather than a cosmetic one, so identity wins and the
 * result is re-sorted by sequence, which is the order the thread is read in.
 */
export function mergeOlder(
  loaded: readonly Message[],
  incoming: readonly Message[],
): readonly Message[] {
  return sortBySequence(dedupe([...incoming, ...loaded]));
}

/** Merges newer messages into a thread, replacing any row whose identifier is already present. */
export function mergeNewer(
  loaded: readonly Message[],
  incoming: readonly Message[],
): readonly Message[] {
  const byId = new Map(loaded.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return sortBySequence([...byId.values()]);
}

function dedupe(messages: readonly Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of messages) {
    if (!byId.has(message.id)) {
      byId.set(message.id, message);
    }
  }

  return [...byId.values()];
}

function sortBySequence(messages: Message[]): Message[] {
  return messages.sort((left, right) => left.sequence - right.sequence);
}

function toCount(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}
