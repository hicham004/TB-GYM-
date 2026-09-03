import type {
  ConversationDetail as ContractConversationDetail,
  ConversationMessagePreview as ContractPreview,
  ConversationPage as ContractConversationPage,
  ConversationParticipantRole,
  ConversationReadState as ContractReadState,
  ConversationSummary as ContractConversationSummary,
  FeatureAccessReason,
  MessageDeletionKind,
  MessagePage as ContractMessagePage,
  MessageView as ContractMessageView,
  MessagingUnreadCount as ContractUnreadCount,
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
  };
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
