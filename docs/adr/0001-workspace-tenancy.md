# ADR 0001: Workspace tenancy

- Status: Accepted
- Date: 2026-08-20

## Context

TB Gym must support an independent coach without requiring a physical gym or company, while
also supporting coaching businesses that have an owner and multiple coaches. A person may
participate in more than one independent coaching workspace.

## Decision

- A `Tenant`, presented as a **Workspace**, is a logical coaching organization. It is not a
  physical-gym record and has no required parent organization.
- Solo coach registration creates a global user, a workspace, and an active `Owner`
  membership in one transaction.
- The same workspace model represents a solo practice and a larger coaching business. A solo
  owner may add coaches later without migrating to a different tenant type.
- Users and workspaces have a many-to-many relationship through tenant memberships. A user
  may be an Owner or Coach in multiple workspaces.
- A client relationship is local to one workspace. Client profiles, subscriptions, notes,
  programs, measurements, permissions, and all other coaching data always carry that
  workspace's `TenantId`.
- There is no cross-workspace shared client profile. A global identity may link to separate
  client profiles in several workspaces, but those profiles never expose data to one another.
- One workspace has one configurable IANA time zone, week start, default culture, and ISO
  currency. These settings are defaults for business behavior, not global constants.

## Consequences

- The database must not contain a required `GymId` above a workspace or a global coach-to-gym
  foreign key.
- Tenant authorization is evaluated for every request and every tenant-owned relationship.
- Composite tenant keys, query filters, write guards, and cross-tenant negative tests remain
  mandatory.
- Organization charts, staff permissions, workspace transfers, and coach invitations may be
  added later without changing the tenant identity.

