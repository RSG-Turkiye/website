export interface CommitteeMember {
  name: string;
  role: string;
  roleTr: string;
  affiliation: string;
  photo: string;
  linkedin?: string;
  /** Which edition year(s) this person served for. */
  editions: number[];
}

/**
 * Empty until the 2026 roster is confirmed. The page and its nav item stay
 * hidden while this is empty -- see src/lib/nav.ts -- so adding the first
 * entry publishes the section with no other change.
 */
export const committee: CommitteeMember[] = [];

export function getCommitteeByEdition(year: number): CommitteeMember[] {
  return committee.filter((m) => m.editions.includes(year));
}
