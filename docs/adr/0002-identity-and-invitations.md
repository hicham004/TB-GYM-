# ADR 0002: Identity reuse and invitations

- Status: Accepted
- Date: 2026-08-20

## Context

A user may work with multiple independent coaches. TB Gym must avoid duplicate credentials
while preventing one workspace from learning anything about another workspace's client
relationship.

## Decision

- Email is unique on the global ASP.NET Core Identity account.
- Coach owners may self-register. Their email must be verified before sign-in, and successful
  registration automatically creates their owned workspace.
- Clients do not publicly self-register in Phase 1. A client enters through a tenant-scoped,
  expiring, revocable invitation sent by an Owner or Coach.
- Invitation tokens use cryptographically secure random values. Only a one-way token hash is
  stored, and every send has a durable record.
- **Clarified by Phase 6B-3C (ADR 0021).** "Resending rotates the token" was written when the only
  thing that could resend was a person pressing a button. It is still exactly right for that, and it
  became wrong for the other thing that can now resend: a dispatcher retrying a transport failure. A
  retry means the first attempt may have succeeded *after* the recipient's mail server accepted it,
  so rotating on retry invalidates a link already sitting in somebody's inbox and shows them a "no
  longer valid" page for an invitation nobody revoked.
  The rule is therefore split. A **deliberate resend** advances the invitation's logical-send
  generation, which revokes every token of every earlier generation immediately — decisive, because
  that is what the person pressing it wanted. A **transport retry** stays on the same generation and
  appends a second token hash, revoking nothing — stable, because a link that reached somebody keeps
  working however many times the dispatcher tries. Acceptance recognises any unexpired, unrevoked,
  unredeemed hash of the current generation.
- Possession of a valid invitation verifies the invited email for a newly created account.
- If the email already belongs to an account, the person signs in to that account before
  accepting. Acceptance then creates only the new tenant membership and tenant-local client
  profile.
- Acceptance is idempotent. Revoked or expired invitations cannot create accounts,
  memberships, or profiles.
- Password reset and explicit session revocation update the Identity security stamp so old
  cookies stop authorizing requests.

## Consequences

- An invitation lookup never reveals memberships or profiles from another tenant.
- The same identity can have multiple tenant-local client profiles without shared coaching
  data.
- Development captures outbound account and invitation emails for testing. The production provider
  sits behind the same seam and is configured before production launch; see ADR 0022.
- Since Phase 6B-3C the token is no longer held on the invitation at all. It is minted at
  materialization, its hash is committed before the provider is invoked, and the invitation carries
  only the generation that says which round of tokens is currently valid. See ADR 0021.

