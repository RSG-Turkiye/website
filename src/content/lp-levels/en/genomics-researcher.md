---
domain: genomics
level: researcher
orientation: "You design analyses independently and read the primary literature. This level covers the statistical foundations, production-grade tools, and landmark papers that define serious genomics work."
prerequisites:
  - Comfortable in R and/or Python
  - Have interpreted DE analysis results and know what a volcano plot shows
  - Understand what a linear model is at a conceptual level
sections:
  - type: foundations
    resources:
      - title: "Reference Genomes, Annotation & the GTF format"
        description: "What a reference genome is, how gene models are built, and why a genome version mismatch causes silent disasters downstream. More people have been burned by this than will admit."
        tag: Reading
        url: "https://www.ensembl.org/info/genome/index.html"
      - title: "How Sequencing Works — from Sanger to long-read"
        description: "Short-read Illumina vs. long-read Nanopore/PacBio — what the machine produces and how the read characteristics shape every downstream analysis choice."
        tag: Course
        url: "https://www.ebi.ac.uk/training/online/courses/functional-genomics-ii-common-technologies-and-data-analysis-methods/"
      - title: "Statistics for Genomics — StatQuest"
        description: "PCA, clustering, multiple testing correction, and the EXACT statistical model behind DESeq2. If you're running these analyses, you need to understand what they're actually computing."
        tag: Videos
        url: "https://www.youtube.com/@statquest"

  - type: toolkit
    resources:
      - title: "STAR / HISAT2 — splicing-aware aligners"
        description: "STAR is faster and more memory-hungry. HISAT2 is smaller and handles SNP-aware alignment. Know both, know when to choose each."
        tag: Tool
        url: "https://github.com/alexdobin/STAR"
      - title: "DESeq2 / edgeR — differential expression"
        description: "DESeq2 for most cases. edgeR when library sizes vary wildly. Read the vignettes, not just the wrapper tutorials — the model choices matter."
        tag: Tool
        url: "https://bioconductor.org/packages/release/bioc/html/DESeq2.html"
      - title: "Seurat / Scanpy — single-cell RNA-seq"
        description: "Seurat (R) and Scanpy (Python) are the two ecosystems. Pick one and learn it deeply — the concepts transfer, but don't context-switch until you've done a full analysis in one."
        tag: Tool
        url: "https://satijalab.org/seurat/"
      - title: "nf-core/rnaseq — production pipeline"
        description: "Run it. Read the MultiQC report it generates. Understand every module it runs. This is how real genomics production work is done."
        tag: Pipeline
        url: "https://nf-co.re/rnaseq"
      - title: "IGV — always look at your reads"
        description: "Non-negotiable at every level. At researcher level: look at reads for every gene you intend to report."
        tag: Tool
        url: "https://igv.org"

  - type: webinars
    resources:
      - title: "Mapping Human Tissue Architecture — Spatial Transcriptomics"
        description: "How spatial transcriptomics extends RNA-seq by preserving tissue context. Cell2location, the Bayesian deconvolution method, is explained clearly by the author."
        tag: Webinar
        speaker: "Dr. Ömer Ali Bayraktar"
        year: 2023
        webinarSlug: mapping-human-tissue-architecture-and-pathology-using-spatial-transcriptomics
      - title: "Predictive Cell-Specific Gene Regulatory Models"
        description: "Building models that predict how regulatory elements drive gene expression in specific cell types — the frontier of gene regulation research."
        tag: Webinar
        webinarSlug: predictive-cell-specific-gene-regulatory-models
      - title: "Short Tandem Repeats in Tumours & Immunotherapy"
        description: "Genomic instability, microsatellites, and why repeat regions matter in cancer genomics. Good for understanding how variant calling connects to clinical outcomes."
        tag: Webinar
        webinarSlug: short-tandem-repeats-tumours-immunotherapy

  - type: papers
    resources:
      - title: "STAR: ultrafast universal RNA-seq aligner (Dobin et al. 2013)"
        description: "The paper behind the most widely used RNA-seq aligner. Read the algorithm section — it explains why STAR handles splicing the way it does, and why that matters for novel junctions."
        tag: Paper
        url: "https://academic.oup.com/bioinformatics/article/29/1/15/272537"
      - title: "DESeq2: moderated estimation of fold change (Love et al. 2014)"
        description: "The statistical model behind differential expression. Required reading before interpreting any DE result — know what 'shrinkage' means and why it's there."
        tag: Paper
        url: "https://genomebiology.biomedcentral.com/articles/10.1186/s13059-014-0550-8"
      - title: "Comprehensive integration of single-cell data (Stuart et al. 2019)"
        description: "Seurat v3 CCA-based integration. The method you'll use to merge datasets from different conditions or batches — understand it before relying on it."
        tag: Paper
        url: "https://www.cell.com/cell/fulltext/S0092-8674(19)30559-8"
---
