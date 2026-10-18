---
domain: metagenomics
level: practitioner
orientation: "You've run a 16S analysis or understand the output from one. This level covers shotgun metagenomics, assembly-based approaches, and the tools that define production metagenomic work."
prerequisites:
  - Understand what OTUs or ASVs are
  - Can use command-line tools
  - Know the difference between taxonomic profiling and functional annotation
sections:
  - type: foundations
    resources:
      - id: "metagenomics-practitioner-foundations-0"
        title: "Shotgun Metagenomics: from reads to functional profiles"
        description: "The full workflow: QC, host removal, assembly vs. read-based profiling, functional annotation. This EBI course is the most systematic free resource available."
        tag: Course
        url: "https://www.ebi.ac.uk/training/online/courses/metagenomics-bioinformatics/"
      - id: "metagenomics-practitioner-foundations-1"
        title: "Metagenome-Assembled Genomes (MAGs): what they are and how to evaluate them"
        description: "Binning assembles contigs into draft genomes without culturing. Knowing how to evaluate completeness and contamination (CheckM metrics) is the difference between a useful MAG and garbage."
        tag: Reading
        url: "https://www.nature.com/articles/s41596-021-00508-2"
      - id: "metagenomics-practitioner-foundations-2"
        title: "Taxonomic profiling: why tools disagree and when it matters"
        description: "Kraken2, MetaPhlAn, mOTUs, Bracken: each makes different trade-offs between sensitivity and precision. Understanding these trade-offs prevents over-confident taxonomic calls."
        tag: Reading
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6898704/"

  - type: toolkit
    resources:
      - id: "metagenomics-practitioner-toolkit-0"
        title: "QIIME2, full amplicon pipeline"
        description: "The standard for 16S/ITS amplicon data. The plugin architecture is complex, start with DADA2 for denoising and a classifier trained on SILVA for taxonomy."
        tag: Pipeline
        url: "https://docs.qiime2.org"
      - id: "metagenomics-practitioner-toolkit-1"
        title: "Kraken2 + Bracken, fast taxonomic classification"
        description: "Kraken2 classifies reads against a reference database at high speed. Bracken re-estimates species-level abundances. Use them together, not separately."
        tag: Tool
        url: "https://github.com/DerrickWood/kraken2"
      - id: "metagenomics-practitioner-toolkit-2"
        title: "MEGAHIT / metaSPAdes, metagenomic assembly"
        description: "MEGAHIT for large datasets (faster, lower memory). metaSPAdes when you have deep coverage and care about longer contigs. Run both on a test dataset to compare."
        tag: Tool
        url: "https://github.com/voutcn/megahit"
      - id: "metagenomics-practitioner-toolkit-3"
        title: "CheckM, MAG quality assessment"
        description: "Estimates completeness and contamination of MAGs using lineage-specific marker genes. A MAG below 50% completeness or above 10% contamination should not be reported as a genome."
        tag: Tool
        url: "https://github.com/Ecogenomics/CheckM"

  - type: webinars
    resources:
      - id: "metagenomics-practitioner-webinars-0"
        title: "Density-based Clustering of Metabarcodes with Nanopore Sequencing"
        description: "Applying long-read sequencing to amplicon metagenomics, the specific challenges of Nanopore error rates and how clustering approaches handle them."
        tag: Webinar
        webinarSlug: density-based-clustering-metabarcodes-nanopore
      - id: "metagenomics-practitioner-webinars-1"
        title: "Understanding Viral Diversity Dynamics"
        description: "Viral metagenomics presents unique challenges: no universal marker gene, high divergence, fragmented assemblies. This talk maps the computational strategies."
        tag: Webinar
        webinarSlug: understanding-viral-diversity-dynamics
      - id: "metagenomics-practitioner-webinars-2"
        title: "Minimizer-Space De Bruijn Graphs for Sequence Assembly"
        description: "The algorithmic foundation of modern metagenome assemblers. Understanding how assembly graphs work helps you interpret why your assembler behaves the way it does."
        tag: Webinar
        webinarSlug: minimizer-space-de-bruijn-graphs
---
