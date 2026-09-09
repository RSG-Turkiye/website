import type { CommitteeMember, Team } from "./content";

/**
 * One rendered block of the committee page: a team and everybody on it.
 *
 * `label` is null for the members who carry no team at all. The page
 * translates that heading; this module stays language-free apart from the
 * `lang` it is handed, so it can be tested as a pure function.
 */
export interface CommitteeTeam {
  label: string | null;
  members: CommitteeMember[];
}

const clean = (value: string | undefined): string => (value ?? "").trim().replace(/\s+/g, " ");

/**
 * Groups committee members by their team labels, in the reader's language.
 *
 * Team names are free text typed into the admin panel, in both languages,
 * which decides four things here:
 *
 * - **Matching is case- and space-insensitive.** "Sosyal Medya", "sosyal
 *   medya" and "Sosyal  Medya" are one team. Turkish casing is used for the
 *   fold, so "İletişim" and "iletişim" match -- `toLowerCase()` alone turns
 *   "I" into "i" but leaves "İ" as "i̇", and the two would not meet.
 * - **A team is keyed on its English name**, falling back to its Turkish one
 *   when there is no English. The limit that follows is worth naming: a
 *   member whose team is English-only and one whose team is Turkish-only are
 *   two groups even if they mean the same team. A team is one team only if
 *   its members agree on at least one spelling. The admin form offers every
 *   name already in use in both fields, which is the cheap mitigation;
 *   guessing across languages is not attempted.
 * - **The heading is the first name given in the reader's language**, in the
 *   order the members are already sorted, falling back to the other language
 *   when nobody has supplied one. So a team entered only in English still
 *   heads the Turkish page rather than leaving it blank.
 * - **Nothing is title-cased**: "RSG" must stay "RSG".
 *
 * Team order is order of first appearance, so the admin panel's own sort
 * decides which team leads the page -- there is no second ordering to keep
 * in step with it.
 *
 * A member on two teams appears under both -- that is the point of the
 * feature. Members with no team come last, in one untagged block.
 *
 * When *nobody* carries a team, the result is a single untagged block, which
 * the page renders as the plain grid it has always shown. Adding the column
 * changed no page that does not use it.
 */
/**
 * The key two spellings of one team must share.
 *
 * Turkish and English disagree about the letter I, and picking either
 * locale's rule alone breaks the other: a Turkish-locale lowercase folds
 * "Iletisim" and "iletisim" together but pulls "RSG MEDIA" apart from
 * "RSG Media" (capital I becomes dotless i), while a plain lowercase does
 * the opposite. Both spellings turn up in these labels -- the teams are
 * Turkish words and the organisation's own name is an English acronym -- so
 * every form of the letter is folded to one before lowercasing.
 *
 * The cost is that dotless and dotted i are the same letter here, so "Sira"
 * spelled either way is one team. For free-text team names that is the
 * better error of the two: it merges what should probably be merged, where
 * the alternative splits a team over a capital letter.
 *
 * A deliberate copy of `teamKey` in functions/_lib/symposium.ts: the two
 * projects share no module, and the write side and the read side must agree
 * on what counts as the same team, or a member lands under a second heading.
 */
function teamKey(value: string): string {
  return value.replace(/[\u0130I\u0131]/g, 'i').toLowerCase();
}

export function groupByTeam(members: CommitteeMember[], lang: "en" | "tr"): CommitteeTeam[] {
  // `named` records whether this group's heading came from the reader's own
  // language or is standing in from the other one. Kept on the group rather
  // than recomputed, so a later member's translation can replace a fallback
  // heading but never overwrite a real one.
  interface Building extends CommitteeTeam { named: boolean }

  const teams: Building[] = [];
  const byKey = new Map<string, Building>();
  const untagged: CommitteeMember[] = [];

  for (const member of members) {
    // Trimmed and collapsed here as well as on the way into the database:
    // the repo's own JSON rosters are hand-edited and never pass through
    // that validation.
    const labels: Team[] = (member.teams ?? [])
      .map((team) => ({ en: clean(team?.en), tr: clean(team?.tr) }))
      .filter((team) => team.en || team.tr);

    if (labels.length === 0) {
      untagged.push(member);
      continue;
    }

    const seen = new Set<string>();
    for (const team of labels) {
      const key = teamKey(team.en || team.tr);
      // A member who lists the same team twice is listed once under it.
      if (seen.has(key)) continue;
      seen.add(key);

      const inLang = lang === "tr" ? team.tr : team.en;
      const group = byKey.get(key);

      if (!group) {
        const created: Building = {
          label: inLang || team.en || team.tr,
          members: [member],
          named: inLang !== "",
        };
        byKey.set(key, created);
        teams.push(created);
        continue;
      }

      group.members.push(member);
      if (!group.named && inLang) {
        group.label = inLang;
        group.named = true;
      }
    }
  }

  const out: CommitteeTeam[] = teams.map(({ label, members: people }) => ({ label, members: people }));
  if (untagged.length > 0) out.push({ label: null, members: untagged });
  return out;
}
