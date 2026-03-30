---
domain: genomics
level: specialist
orientation: "You're publishing or preparing to publish. This level covers long-read technologies, single-cell multi-omics, and the tools and papers that have moved the field in the last three years."
prerequisites:
  - Have run scRNA-seq analysis (Seurat or Scanpy)
  - Understand batch correction and integration methods conceptually
  - Read methods papers comfortably — you can evaluate statistical claims
sections:
  - type: foundations
    resources:
      - title: "Long-read sequencing: what changes with Nanopore and PacBio"
        description: "Long reads solve problems short reads can't — full isoform resolution, structural variants, repeat regions. This review maps the analytical landscape: what tools exist and where they still fail."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-023-00586-w"
      - title: "Single-cell multi-omics: joint profiling of RNA and chromatin"
        description: "CITE-seq, ATAC+RNA, spatial multi-omics — measuring multiple modalities per cell changes what questions you can ask. This review covers the current state of integration methods."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-023-00586-w"

  - type: toolkit
    resources:
      - title: "ArchR / Signac — single-cell ATAC-seq"
        description: "scATAC-seq analysis requires a different mental model than scRNA-seq. ArchR (R) and Signac (R, Seurat-integrated) are the dominant tools — both have excellent vignettes."
        tag: Tool
        url: "https://www.archrproject.com"
      - title: "scVI / scANVI — probabilistic single-cell integration"
        description: "Deep generative models for integrating datasets across conditions, donors, and batches. More principled than CCA-based approaches for large, heterogeneous cohorts."
        tag: Tool
        url: "https://scvi-tools.org"
      - title: "Minimap2 — long-read alignment"
        description: "The standard aligner for long reads. Different parameter profiles for DNA vs. RNA (splice-aware), Nanopore vs. PacBio. Know the presets before tuning."
        tag: Tool
        url: "https://github.com/lh3/minimap2"
      - title: "Snakemake — workflow management for custom pipelines"
        description: "When nf-core doesn't do exactly what you need, you write your own pipeline. Snakemake's rule-based model is easier to reason about than Nextflow for one-off research workflows."
        tag: Tool
        url: "https://snakemake.readthedocs.io"

  - type: webinars
    resources:
      - title: "Predictive Cell-Specific Gene Regulatory Models"
        description: "The frontier of regulatory genomics: models that predict gene expression from sequence features at cell-type resolution. Directly relevant to any work on enhancers, TF binding, or gene regulation."
        tag: Webinar
        webinarSlug: predictive-cell-specific-gene-regulatory-models
      - title: "Mapping Human Tissue Architecture — Spatial Transcriptomics"
        description: "Cell2location and spatial deconvolution in practice. If you're working with spatial data, hear from the group that developed the method."
        tag: Webinar
        speaker: "Dr. Ömer Ali Bayraktar"
        year: 2023
        webinarSlug: mapping-human-tissue-architecture-and-pathology-using-spatial-transcriptomics

  - type: papers
    resources:
      - title: "Weighted nearest-neighbour analysis for single-cell multimodal data (Hao et al. 2021)"
        description: "Seurat v4's WNN framework for joint RNA+protein or RNA+ATAC analysis. The method you'll use for any multi-modal single-cell experiment."
        tag: Paper
        url: "https://www.cell.com/cell/fulltext/S0092-8674(21)00583-3"
      - title: "Deep generative modelling for single-cell transcriptomics — scVI (Lopez et al. 2018)"
        description: "The paper that introduced variational autoencoders to single-cell genomics. Read it to understand what scVI is actually doing when it 'integrates' datasets."
        tag: Paper
        url: "https://www.nature.com/articles/s41592-018-0229-2"
      - title: "Cell2location maps fine-grained cell types in spatial transcriptomics (Kleshchevnikov et al. 2022)"
        description: "Bayesian deconvolution of spatial transcriptomics data. If you're working with Visium or similar, this is the method paper to understand."
        tag: Paper
        url: "https://www.nature.com/articles/s41587-021-01139-4"
---
