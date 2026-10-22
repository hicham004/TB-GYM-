import { computed, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import type {
  LegalAudience as ContractLegalAudience,
  LegalConsentContext,
  LegalDocumentKind,
  LegalDocumentText,
  LegalDocumentToAccept,
} from '../../core/api/generated';

/**
 * The legal documents' words on screen (audit INV-3, CLI-010). TB Gym writes none of a document: its
 * text and the sentence beside the box a person ticks are the published version's own, as a qualified
 * reviewer approved them. What is here only names the documents and says how to use the page.
 */

export type LegalKind = LegalDocumentKind;
export type LegalContext = LegalConsentContext;
export type LegalAudience = ContractLegalAudience;

/** The documents the platform admin can publish, in the order they are listed and asked. */
export const LEGAL_KINDS: readonly LegalKind[] = [
  'TermsOfService',
  'PrivacyPolicy',
  'HealthIntakeConsent',
];

/**
 * English, which TB Gym ships (ADR 0003); the server refuses any other for now, as a translation published
 * apart from its English could lag behind it and still count.
 */
export const LEGAL_LANGUAGES = ['en'] as const;
export type LegalLanguage = (typeof LEGAL_LANGUAGES)[number];

export function legalKindName(kind: LegalKind): string {
  switch (kind) {
    case 'TermsOfService':
      return $localize`Terms of Service`;
    case 'PrivacyPolicy':
      return $localize`Privacy Policy`;
    case 'HealthIntakeConsent':
      return $localize`Health intake consent`;
  }
}

export function legalLanguageName(culture: string): string {
  return culture === 'ar' ? $localize`Arabic` : $localize`English`;
}

/** Who accepts a version, and how often: once per person, or in each coaching space they join. */
export function legalContextName(context: LegalContext): string {
  return context === 'Workspace'
    ? $localize`In each coaching space they join`
    : $localize`Once per person`;
}

/** The same inside a sentence: "once per person", "in each coaching space they join". */
export function legalContextClause(context: LegalContext): string {
  return context === 'Workspace'
    ? $localize`in each coaching space they join`
    : $localize`once per person`;
}

/** Who is asked to accept a document, as the server's rule (LegalAcceptanceRule) decides it. */
export function legalAudienceLine(kind: LegalKind): string {
  return kind === 'HealthIntakeConsent'
    ? $localize`Asked of clients when they accept an invitation.`
    : $localize`Asked of everyone who creates a coaching space or accepts an invitation.`;
}

/**
 * A text's paragraphs as its reader sees them: one or more blank lines start a new paragraph, and a single
 * line break stays inside one, as do a line's spaces and indent. Nothing is added or taken out of the words.
 */
export function legalParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n(?:[ \t]*\n)+/)
    .map((paragraph) => paragraph.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, ''))
    .filter((paragraph) => paragraph.trim() !== '');
}

/** One document a person ticks to join. */
export interface LegalToAccept {
  readonly id: string;
  readonly kind: LegalKind;
  readonly name: string;
  readonly version: string;
  /** The sentence beside the box, the published version's own words. */
  readonly statement: string;
  readonly culture: string;
  /** The app's own page for the version, opened in a new tab so the form stays as it was. */
  readonly link: string;
}

export function toLegalToAccept(document: LegalDocumentToAccept): LegalToAccept {
  return {
    id: document.id,
    kind: document.kind,
    name: legalKindName(document.kind),
    version: document.version,
    statement: document.acceptanceStatement,
    culture: document.culture,
    link: `/legal/${encodeURIComponent(document.id)}`,
  };
}

/** A submit refused while a box is unticked says which document: one reason each. */
export function legalReasons(
  documents: readonly LegalToAccept[],
  accepted: ReadonlySet<string>,
): string[] {
  return documents
    .filter((document) => !accepted.has(document.id))
    .map((document) => $localize`Tick the box for the ${document.name}:document:.`);
}

/** The ticked documents still on the page: what a submit names. */
export function acceptedIds(
  documents: readonly LegalToAccept[],
  accepted: ReadonlySet<string>,
): string[] {
  return documents.filter((document) => accepted.has(document.id)).map((document) => document.id);
}

/** Ticks kept across a fresh read, for the documents still shown; a replaced one starts unticked. */
export function keptTicks(
  documents: readonly LegalToAccept[],
  accepted: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(acceptedIds(documents, accepted));
}

/** What the server answers when a document changed or was left out while the page was open. */
export const LEGAL_ACCEPTANCE_REQUIRED = 'legal_acceptance_required';

export function legalChangedSentence(): string {
  return $localize`The documents to accept changed while this page was open. Read them again below and tick each box.`;
}

/** What the page says when the server asked for a document and the documents could not be read again. */
export function legalUnreadSentence(): string {
  return $localize`The documents to accept couldn’t be loaded. Check your connection, then try again.`;
}

/**
 * The documents a page asks a person to tick and what they ticked (audit INV-3), for registration and an
 * invitation alike. Nothing is asked until a read succeeds; the server refuses a submit that leaves a
 * document out, and `refused()` reads them again then.
 */
export class LegalChoices {
  readonly documents = signal<readonly LegalToAccept[]>([]);
  readonly accepted = signal<ReadonlySet<string>>(new Set());
  /** One reason per box still to tick. */
  readonly missing = computed(() => legalReasons(this.documents(), this.accepted()));
  /** What a submit names: the ticked documents still shown. */
  readonly ids = computed(() => acceptedIds(this.documents(), this.accepted()));

  constructor(private readonly read: () => Observable<LegalToAccept[]>) {}

  /** Reads what is in force, a tick kept only where its version is still shown; false when it failed. */
  async load(): Promise<boolean> {
    try {
      const documents = await firstValueFrom(this.read());
      this.documents.set(documents);
      this.accepted.set(keptTicks(documents, this.accepted()));
      return true;
    } catch {
      return false;
    }
  }

  toggle(change: { id: string; checked: boolean }): void {
    this.accepted.update((accepted) => {
      const next = new Set(accepted);
      if (change.checked) next.add(change.id);
      else next.delete(change.id);
      return next;
    });
  }

  /** The server asked for a document: what the page says once it has read them again, or could not. */
  async refused(): Promise<string> {
    return (await this.load()) ? legalChangedSentence() : legalUnreadSentence();
  }
}

/** A published version as its reading page shows it. */
export interface LegalDocumentPage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly culture: string;
  readonly paragraphs: string[];
  readonly statement: string;
  readonly fingerprint: string;
  readonly publishedAtUtc: string;
  readonly retiredAtUtc: string | null;
}

export function toLegalDocumentPage(document: LegalDocumentText): LegalDocumentPage {
  return {
    id: document.id,
    name: legalKindName(document.kind),
    version: document.version,
    culture: document.culture,
    paragraphs: legalParagraphs(document.content),
    statement: document.acceptanceStatement,
    fingerprint: document.contentSha256,
    publishedAtUtc: document.publishedAtUtc,
    retiredAtUtc: document.retiredAtUtc ?? null,
  };
}
