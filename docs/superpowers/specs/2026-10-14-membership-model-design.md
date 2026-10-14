# Membership model: followers and members

Date: 2026-10-14. Status: agreed in conversation, written for review.

## Why

A former chair advised the team that RSG-Türkiye is the ISCB Student
Council's academic regional student group, not a university club:

- anyone may follow the group;
- membership is for people actually doing research in computational biology
  and bioinformatics;
- a small real core is better than a large list.

The site's identity copy already says this (PR #271). The site itself does
not.

Today `users.is_member` gates nothing:

- any signed-in user sees the members directory, which lists every public
  profile, member or not;
- the Join page's Google Form is not connected to accounts, so an admin
  matches form emails to users by hand;
- membership has no start date, no lifecycle and no review;
- automatic ranks (seed, sprout, sapling, legacy tree) rise with
  learning-path progress and are easy to mistake for membership.

## What members get

1. The members directory, which only active members can see and which lists
   only active members.
2. The Slack members channel. The existing workspace stays open to
   followers; a new private channel is for members.
3. Eligibility for team roles and elections. The site exports the
   active-member list; voting happens outside the site.

Followers (signed-in non-members) keep their account, profile, learning-path
progress and everything public.

## Applying

Applications move from the Google Form into the site:

- **Sign-in first.** The applicant signs in with Google, then fills in the
  form on the Join page, so the application belongs to their account.
- **Required fields:**
  - a short research statement (what they work on);
  - institution;
  - programme: master's, PhD, postdoc or undergraduate;
  - supervisor or lab.
- **Optional fields** (signals for the reviewer, none decisive alone):
  - links: LinkedIn, ORCID, Google Scholar, GitHub, lab page;
  - institutional email verification;
  - a reference: the name of a member or academic who knows their work.
- **Institutional email verification.** The applicant enters an
  institutional address and receives a 6-digit code by the site's existing
  mail system. Entering it marks the application "institutional email
  verified". A verified address does not prove bioinformatics research; the
  research statement decides.
- **Rejected applicants** may apply again 6 months after the decision.
- **Status on the account page:** submitted (results after the round
  closes), approved, or not approved.

## Admission rounds

Applications are taken in rounds, like an admission:

- **Opening a round.** A reviewer opens a round in the panel:
  - name (for example "2026 Güz");
  - opening and closing date;
  - an optional quota, shown publicly as a target ("15 places this round").
    The number of applications is never shown.
- **While a round is open:** the Join page shows the form and the closing
  date.
- **While no round is open:** the Join page says applications are closed,
  with the next round's date if known.
  - A signed-in follower can press "Tell me when applications open".
  - When the next round opens, that list gets one email and is then cleared.
- **Batch review.** Reviewers record a decision on each application during
  or after the round:
  - approve, or reject with a required note;
  - the quota is a target: going over it warns, it does not block.
- **Releasing decisions.** Decisions stay drafts, invisible to applicants,
  until a reviewer presses "Send decisions". All emails then go out
  together, a rejection with its note. Approved applicants become active
  members at that moment.

## Reviewing

- **Role.** A new role, membership reviewer (`is_membership_reviewer`), is
  granted by an admin from the users list like the other roles. Admins have
  it implicitly. The board holds it.
- **Panel tab "Membership"**, for reviewers and admins only. It has five
  parts:
  - **Rounds:** create, edit, close and release.
  - **Applications** of the current round, one card each: statement,
    institution, programme, supervisor or lab, links, institutional-email
    badge, reference, and a "flagged" label when it applies (see
    *Reactivation*). Approve or reject with a note.
  - **Requests:** reactivation requests from passive members.
  - **Members:** the active and passive members list, the yearly review and
    the Slack lists.
  - **History:** every decision, with who, when and the note.
- **One reviewer's decision is enough.** Every decision, release,
  revocation, flag and export goes to the audit log.
- **Emails to reviewers**, sent by the daily cron and skipped when there is
  nothing to say:
  - a weekly summary while a round is open: the number of applications
    received;
  - "time to review" when a round closes;
  - a reminder if decisions are recorded but not yet released 7 days after
    closing.
- **Revocation.** A reviewer may revoke a membership later (a wrong
  approval, for example), with a required note.

## Active and passive members

Each account has one membership state:

- **non-member** (follower);
- **active member**;
- **passive member:** account and profile kept, hidden from the directory,
  no Slack invite link, can ask to be reactivated.

There is no automatic expiry. Once a year the board reviews the active
members:

- **Review screen.** The Members part of the tab lists every active member
  with hints: last sign-in, last profile or statement update, team roles
  held, and member since. When event feedback (roadmap part D) exists,
  attendance is added as a hint.
- **Deciding.** The default is "stays active". Reviewers mark only those to
  move to passive.
- **Reminder.** Each September reviewers get an email that the yearly review
  is due. The month is a panel setting, and it falls in the academic-year
  handover.

### Reactivation

- **Asking.** A passive member sees "My membership is passive: ask to be
  active again" on their account page. The request goes to the Requests
  list; one reviewer approves it, without a new application.
- **When requests are accepted.** Reactivation requests are not tied to
  rounds.
- **Flagged members.** A reviewer may put the flag "reactivation needs
  review" on an active member, with a short internal note visible only to
  reviewers.
  - Nothing changes while the member is active. The flag is invisible to
    the member.
  - If they later become passive, their reactivation request, or a new
    application, arrives labelled "flagged", with the note. It shows the
    same message every member sees ("your request has been sent to the
    team"), which is true; the team simply does not approve it.
  - The flag can be removed at any time. Setting and removing it are
    audited.
  - Notes stay factual and short: the person can see their data on
    request under KVKK.

## Members directory

- **Who sees it.** Visible to active members only. A signed-in non-member
  sees "This page is for members" and a link to apply.
- **Who is listed.** Active members only.
- **Cards** show:
  - name, institution and programme;
  - research area;
  - interests;
  - skill badges (admin-awarded, unchanged);
  - the self-chosen tags such as "open to collaborate" and "open to mentor".
- **Links.** Profile links are whatever the member put on their profile.
  The application's links are not copied automatically.

## Ranks

- **Removed from display.** Automatic ranks and auto-promotion are removed
  from every page and from the progress endpoint.
- **History kept.** `rank_history` rows are kept, not deleted, and simply no
  longer read.
- **Unchanged:** learning-path progress, skill badges and the
  self-declared tags.

## Slack

- **Invite link.** A panel setting holds the members-channel invite link.
  The link is shown only on active members' account pages.
- **Lists.** The Members part of the tab has two lists, each item ticked by
  an admin when done in Slack by hand:
  - "to invite": newly approved and reactivated members;
  - "to remove": newly passive and revoked members.
- **What the site does not do.** It does not call Slack. The team's Slack
  bot already prunes silent accounts in its own way; the site does not
  depend on it.

## Elections

Reviewers can download the active-member list (name, email) as CSV. Every
download is audited.

## Existing members

- **Who becomes active.** Everyone with `is_member = 1` becomes an active
  member at launch, with "member since" set to the launch date (their real
  start is unknown).
- **New rules apply to new applicants only.** Existing members see a gentle
  "add your research statement" prompt on their account page. It is
  optional.
- **Signed-in non-members** become followers. They are no longer listed in
  the directory and can no longer see it.

## Data

New columns on `users`:

- `membership`: `none`, `active` or `passive`. It replaces `is_member`, which
  is kept in sync during the transition and then retired.
- `member_since`.
- `reactivation_flag` and `reactivation_note`.

New tables:

- `membership_rounds`: id, name, opens_at, closes_at, quota, released_at.
- `membership_applications`:
  - id, user_id, round_id;
  - statement, institution, programme, supervisor, links (JSON);
  - inst_email and inst_email_verified_at;
  - reference;
  - status: submitted, approved or rejected;
  - decision_note, decided_by, decided_at;
  - released_at, created_at.
- `membership_requests`: id, user_id, kind (reactivation), status, created_at,
  decided_by, decided_at.
- `membership_notify`: user_id, created_at. The "tell me when applications
  open" list.
- `membership_slack_todo`: user_id, action (invite or remove), created_at,
  done_by, done_at.
- Settings: Slack invite link, review month.
- Verification codes: hashed, valid 15 minutes, at most 5 tries.

Retention, added to the privacy policy:

- rejected applications are deleted 12 months after the decision;
- approved ones are kept while the person is a member;
- the "tell me" list is cleared after its email.

## Out of scope

- Voting on the site.
- Calling the Slack API.
- A public members showcase.
- Members-only events (they come with the content plan, roadmap part D).
- Automatic activity scoring.

## Testing

- Unit tests for each endpoint:
  - roles and authorization: reviewer, admin, member, follower, signed out;
  - round windows: closed form, open form, quota warning;
  - decisions staying drafts until release;
  - the 6-month reapply rule;
  - the email-code flow: expiry, tries, hashing;
  - reactivation with and without the flag;
  - directory visibility;
  - the CSV export audit;
  - the existing-member migration.
- i18n parity for every new string.
- A browser check of the apply, review, release and directory flows, signed
  in, as the project does for other auth UI.
