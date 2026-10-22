# Feature Specification: Contact persons on a partner (F08)

**Feature Branch**: `feat/partners-contacts`

**Created**: 2026-10-22

**Status**: Read by the owner 2026-10-22 ("go") — planned

**Input**: "F08 contact persons on a partner, module partners: name, role, email, phone; shown on the partner page." Roadmap A4; [[feature-inventory]] §3.3 keeps "contact persons" from v1 (`Partner` + `Contact`).

## Why

A partner today has one company-level e-mail and phone. A client has people: the manager who signs the timesheet, the accounts-payable address invoices go to, the procurement person. The owner wants them next to the partner, not in his head or his mail client.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a contact person (Priority: P1)

The owner opens a partner (`/partners/<id>`), goes to the **Contacts** tab, clicks **Add contact**, types *Anne Muster* · *Head of BI* · `anne.muster@vaudoise.ch` · `+41 21 618 80 80`, and saves. The row appears in the list; the tab label reads *Contacts (1)*.

**Why this priority**: it is the feature.

**Independent Test**: on a partner with no contact, add one through the service; list the partner's contacts: one row with the four values as typed (trimmed); the audit trail has the creation.

**Acceptance Scenarios**:

1. **Given** a partner with no contact, **When** the owner adds *Anne Muster* with role, e-mail and phone, **Then** the list shows one row with those four values and the tab reads *Contacts (1)*.
2. **Given** the add form, **When** only the name is filled, **Then** the contact is saved; role, e-mail and phone are empty and shown as `—`.
3. **Given** the add form, **When** the name is empty (or only spaces), **Then** it is refused with *Name is required* and nothing is saved.
4. **Given** the add form, **When** the e-mail is not an address (`anne@`), **Then** it is refused with *Not a valid e-mail address* and nothing is saved.
5. **Given** a partner with contacts, **When** the list is shown, **Then** it is sorted by name (case-insensitive), and an e-mail is a `mailto:` link, a phone a `tel:` link.

---

### User Story 2 - Correct or remove a contact (Priority: P1)

People change roles and leave. The owner edits a contact in place (any of the four fields) or deletes it after a confirmation.

**Independent Test**: create a contact, change its role, read it back; delete it, the partner has no contact; both changes are audited.

**Acceptance Scenarios**:

1. **Given** a contact, **When** the owner changes the role from *Head of BI* to *CDO*, **Then** the row shows *CDO* and the audit trail has the before/after.
2. **Given** a contact, **When** the owner clears the e-mail, **Then** it is saved empty (the same validation as on add applies to every edit).
3. **Given** a contact, **When** the owner deletes it and confirms, **Then** it is gone from the list, the count drops, the deletion is audited.
4. **Given** a contact id of another partner or another tenant, **When** an edit or delete is attempted with it, **Then** it is refused as not found.

---

### User Story 3 - See the contacts at a glance (Priority: P2)

On the partner page the **Overview** summary shows the number of contacts next to the contract count, and the tab carries the count — the owner sees there are people to call without opening the tab.

**Acceptance Scenarios**:

1. **Given** a partner with 2 contacts, **When** the page opens, **Then** the tab reads *Contacts (2)* and the overview summary shows *Contacts 2*.

---

### Edge Cases

- **Any partner type** has contacts — a client, a vendor (their support desk), an employee partner (rarely, but not forbidden).
- **An inactive partner** keeps its contacts and they stay editable; deactivation is about invoicing, not about the address book.
- **A partner is never deleted from the app** (deactivation is soft); should a partner row ever be removed, its contacts go with it — a contact never outlives its partner.
- **Duplicates are allowed**: two *Anne Muster* on the same partner are not refused — a name is not a key.
- **The partner's own e-mail and phone** stay as they are (the company's switchboard / generic address); a contact does not replace them and nothing is migrated between them.
- **A read-only role** (the accountant, when invited) sees the tab and the list, without the add / edit / delete controls — the same rule as the partner itself.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A partner has zero or more contact persons; each has a **name** (required, 1–200 characters after trimming), a **role** (optional, ≤ 100), an **e-mail** (optional, a valid address, ≤ 254), a **phone** (optional, free text, ≤ 50 — numbers are typed in any format, `+41 …`, `08-…`).
- **FR-002**: The owner can add, edit and delete a contact from the partner page; deleting asks for a confirmation. Every change goes through the audit trail with before/after.
- **FR-003**: The partner page has a **Contacts (n)** tab listing the contacts sorted by name, with `mailto:` / `tel:` links; the overview summary shows the count.
- **FR-004**: Permissions follow the partner's: who may manage partners may manage their contacts; who may read partners may read them.
- **FR-005**: Contacts are tenant-scoped like every table (RLS); a contact always belongs to exactly one partner of the same tenant.
- **FR-006**: Every new string exists in en, fr and sv.

### Key Entities

- **Contact person** — name, role, e-mail, phone; belongs to one partner. Not a linkable entity (nothing is linked to a person), no history beyond the audit trail.

## Out of scope (named so nobody builds it by accident)

- A contact on the invoice (an *Attn:* / *Your reference* line picked from the contacts) — possible later, its own feature.
- A *primary* / default contact flag, notes, address per contact, a contacts page across partners, contacts in the global search, import from v1.
- Sending e-mail from the app (out of scope by decision).

## Success Criteria *(mandatory)*

- **SC-001**: The owner records the people of his main client in under a minute, without leaving the partner page.
- **SC-002**: The unit tests cover the rules (validation, tenant / partner scoping, audit); one e2e journey adds, edits and deletes a contact on a partner it creates.

## Assumptions

- A tab rather than a section of the Overview tab: Overview already holds the summary and the partner form; a list with its own actions reads better on its own, the same way as Contracts.
- One migration, additive (a new table) — nothing dropped, nothing rewritten.
