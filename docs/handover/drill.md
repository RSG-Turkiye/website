# Crash drill and handover sessions

A script for rehearsing a failure before the handover. It holds no fixtures:
the faults are prepared in December, right before the drill, and never merged.

## Who and when

- **Who:** the website lead, or if there is none, a management-team member.
  The current chair only watches and does not help.
- **When:** December 2026, before the handover.

## Rules

- Every fault is set up off live: a branch, a pull request that is never
  merged, or a local copy. Never on the live site and never on real accounts.
- Scenario 3 is read-only: it uses the live Overview card, with the lead
  beside the person, and changes nothing.
- The person fixes each fault using only these docs and their own agent.
- Every place they get stuck becomes a docs fix the same day.
- Commands that touch production are given to the person by the agent, as in
  [CLAUDE.md](../../CLAUDE.md), "Working with a non-terminal maintainer".

## Scenario 1: red CI on a branch

- **Setup:** a branch with one deliberately failing test, pushed with a PR
  that is never merged.
- **The person is told:** "The check on this PR is red. Find out why and fix it."
- **Solved when:** the person and agent name the failing step in GitHub
  Actions, reproduce it locally on Node 22 (see [troubleshooting.md](troubleshooting.md#ci-is-red-on-a-pr-that-passes-locally)), fix it, and the checks go green.

## Scenario 2: "I saved in the panel but the site did not change"

- **Setup:** pick a past CMS pull request and the Deployments list in
  Cloudflare Pages; nothing is changed on live.
- **The person is told:** "Someone saved a change a day ago and the page is
  unchanged. What do you check?"
- **Solved when:** the person finds the merge commit, checks whether a
  deployment exists for it, and explains the empty-commit PR fix and who merges
  it, and why a `cms/*` PR is never merged by hand ([troubleshooting.md](troubleshooting.md#a-panel-save-or-a-merged-pr-never-shows-on-the-site)).

## Scenario 3: "the usage alert says 70%"

- **Setup:** none. Use the real Overview card read-only, on a local copy or
  with the lead beside them.
- **The person is told:** "The admins got a 70% usage mail. Is it a problem?"
- **Solved when:** the person reads today's numbers on the Overview card,
  explains the free-plan limits and the 00:00 UTC reset, and has the agent
  run the read-only `d1 insights` command once the person has logged in with
  `npx wrangler login` ([troubleshooting.md](troubleshooting.md#quota-d1-errors-or-the-usage-alert)).

## Handover-session checklist

- Accounts and access transferred, row by row, per [accounts.md](accounts.md).
- The places where secrets are set are known (places, not values).
- The admin role is granted to the incoming people: at least two admins.
- `GITHUB_NOTIFY_USERNAME` points to whoever now merges the symposium archive PR.
- One real PR is merged together in the first week.
- Feature freeze in the last weeks of January.
