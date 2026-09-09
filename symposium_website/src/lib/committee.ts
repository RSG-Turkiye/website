import type { CommitteeMember } from "./content";

/**
 * One rendered block of the committee page: a team and everybody on it.
 *
 * `label` is null for the members who carry no team at all. The page
 * translates that heading; this module stays language-free so it can be
 * tested as a pure function.
 */
export interface CommitteeTeam {
  label: string | null;
  members: CommitteeMember[];
}

/**
 * Groups committee members by their team labels.
 *
 * Team names are free text typed into the admin panel, which decides three
 * things here:
 *
 * - **Matching is case- and space-insensitive.** "Sosyal Medya", "sosyal
 *   medya" and "Sosyal  Medya" are one team. Turkish casing is used for the
 *   fold, so "İletişim" and "iletişim" match -- `toLowerCase()` alone turns
 *   "I" into "i" but leaves "İ" as "i̇", and the two would not meet.
 * - **The heading is the first spelling seen**, in the order the members are
 *   already sorted. Nothing is title-cased: "RSG" must stay "RSG".
 * - **Team order is order of first appearance**, so the admin panel's own
 *   sort decides which team leads the page. There is no separate ordering to
 *   keep in step with it.
 *
 * A member on two teams appears under both -- that is the point of the
 * feature. Members with no team come last, in one untagged block.
 *
 * When *nobody* carries a team, the result is a single untagged block, which
 * the page renders as the plain grid it has always shown. Adding the column
 * changed no page that does not use it.
 */
export function groupByTeam(members: CommitteeMember[]): CommitteeTeam[] {
  const teams: CommitteeTeam[] = [];
  const byKey = new Map<string, CommitteeTeam>();
  const untagged: CommitteeMember[] = [];

  for (const member of members) {
    // Trimmed and collapsed here as well as on the way into the database:
    // the repo's own JSON rosters are hand-edited and never pass through
    // that validation.
    const labels = (member.teams ?? [])
      .map((team) => team.trim().replace(/\s+/g, " "))
      .filter(Boolean);

    if (labels.length === 0) {
      untagged.push(member);
      continue;
    }

    const seen = new Set<string>();
    for (const label of labels) {
      const key = label.toLocaleLowerCase("tr");
      // A member who lists the same team twice is listed once under it.
      if (seen.has(key)) continue;
      seen.add(key);

      let team = byKey.get(key);
      if (!team) {
        team = { label, members: [] };
        byKey.set(key, team);
        teams.push(team);
      }
      team.members.push(member);
    }
  }

  if (untagged.length > 0) teams.push({ label: null, members: untagged });
  return teams;
}
