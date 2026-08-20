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
  stored. Resending rotates the token, and every send has a delivery record.
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
- Development captures outbound account and invitation emails for testing. A production
  provider remains behind the same ports and is configured before production launch.

