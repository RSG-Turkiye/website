---
domain: metagenomics
level: explorer
orientation: "Metagenomics sequences entire microbial communities from environmental samples: gut, soil, ocean. This level explains what you're actually measuring, why it's technically hard, and gives you first tools to explore real data without code."
prerequisites:
  - Basic biology (you know what bacteria and microbes are)
sections:
  - type: foundations
    resources:
      - id: "metagenomics-explorer-foundations-0"
        title: "What is Metagenomics? (EBI Overview)"
        description: "The key distinction: metagenomics sequences the collective genome of a community, not a single organism. This changes what questions you can ask, and what you can't."
        tag: Reading
        url: "https://www.ebi.ac.uk/training/online/courses/metagenomics-bioinformatics/"
      - id: "metagenomics-explorer-foundations-1"
        title: "16S rRNA vs Shotgun Metagenomics: when to choose each"
        description: "16S targets one gene (cheap, taxonomic); shotgun sequences everything (expensive, functional). The choice of approach determines what you can learn and what the analysis looks like."
        tag: Reading
        url: "https://www.illumina.com/areas-of-interest/microbiology/microbial-sequencing-methods/shotgun-metagenomic-sequencing.html"
      - id: "metagenomics-explorer-foundations-2"
        title: "The Human Microbiome Project, why microbiome science matters"
        description: "The project that established the baseline diversity of the human microbiome. Reading the overview gives you the biological motivation before the technical details."
        tag: Reading
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3153527/"

  - type: toolkit
    resources:
      - id: "metagenomics-explorer-toolkit-0"
        title: "MicrobiomeDB, explore public microbiome data without code"
        description: "Browse, visualise, and compare thousands of published microbiome studies through a web interface. Start here before writing a single line of analysis code."
        tag: Platform
        url: "https://microbiomedb.org"
      - id: "metagenomics-explorer-toolkit-1"
        title: "QIIME2, Moving Pictures Tutorial"
        description: "QIIME2's introductory tutorial uses time-series data from a real study. Follow it end-to-end using their test data, you'll see the full 16S workflow before applying it to your own samples."
        tag: Tutorial
        url: "https://docs.qiime2.org/2024.10/tutorials/moving-pictures/"
---
