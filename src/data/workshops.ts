/**
 * RSG-Türkiye's hands-on workshops whose materials are public on GitHub
 * (github.com/RSG-Turkiye). Listed in /llms.txt; the learning paths link the
 * ones that fit a level. Newest first. A workshop whose materials are not
 * public does not belong here: this is a list of things a reader can open.
 */
export interface Workshop {
  year: number;
  title: string;
  /** What a reader can learn from the materials, in a few words. */
  topics: string;
  repo: string;
}

export const WORKSHOPS: Workshop[] = [
  { year: 2024, title: 'Single-cell RNA-seq with Seurat', topics: 'Seurat v5, cell-type annotation, dataset integration', repo: 'RSG-Single-Cell-Workshop2024' },
  { year: 2021, title: 'Computational Structural Biology', topics: 'structure visualisation, docking (HADDOCK, SWISS, PRISM), molecular dynamics with NAMD', repo: 'Computational_Structural_Biology_Workshop' },
  { year: 2021, title: 'Command Line Tools', topics: 'Linux, bash, sed/awk/grep, git; long-read genome assembly and RNA-seq practicals', repo: 'Workshop2021' },
  { year: 2020, title: 'Introduction to Single-Cell Analysis', topics: 'scRNA-seq and scATAC-seq', repo: 'Single-Cell-Workshop2020' },
  { year: 2020, title: 'Symposium workshop session', topics: 'R programming, machine learning in R, ggplot2', repo: 'Workshop2020' },
  { year: 2019, title: 'Python for Bioinformatics (AnkaPy)', topics: 'Python, Biopython (FASTA, BLAST, Entrez), numpy, pandas, matplotlib', repo: 'AnkaPy' },
];

export const workshopUrl = (w: Workshop) => `https://github.com/RSG-Turkiye/${w.repo}`;
