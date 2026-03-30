---
domain: genomics
level: practitioner
orientation: "You've run at least one end-to-end analysis and can navigate a terminal. This level focuses on doing it right — understanding what each step actually does, what can go wrong, and how to trust your results."
prerequisites:
  - Can navigate the Unix command line
  - Know what FASTQ, BAM, and count matrix files are
  - Have run at least one bioinformatics pipeline (Galaxy counts)
sections:
  - type: foundations
    resources:
      - title: "RNA-seq Workflow End-to-End — Harvard HBC"
        description: "The most complete free RNA-seq course. QC → trimming → alignment → quantification → DE analysis, with explanations of why each step exists."
        tag: Tutorial
        url: "https://hbctraining.github.io/Intro-to-rnaseq-hpc-salmon-flipped/"
      - title: "FastQC / MultiQC — always QC first"
        description: "Before any analysis: run FastQC on your raw reads and MultiQC to aggregate reports. Most analysis failures are detectable at this step."
        tag: Tool
        url: "https://multiqc.info"
      - title: "Understanding alignment: what STAR is doing"
        description: "Splicing-aware alignment is not just 'matching reads to a genome'. Understanding the splice junction problem explains why STAR exists and when it matters."
        tag: Reading
        url: "https://github.com/alexdobin/STAR/blob/master/doc/STARmanual.pdf"

  - type: toolkit
    resources:
      - title: "STAR — splicing-aware aligner"
        description: "The de-facto standard for RNA-seq alignment. Fast, handles splicing, produces sorted BAM files. Know the key parameters before changing defaults."
        tag: Tool
        url: "https://github.com/alexdobin/STAR"
      - title: "DESeq2 — differential expression"
        description: "The standard for bulk RNA-seq differential expression. Understand the negative binomial model and why you need count data (not FPKM) as input."
        tag: Tool
        url: "https://bioconductor.org/packages/release/bioc/html/DESeq2.html"
      - title: "IGV — always look at your reads"
        description: "Non-negotiable. Inspect aligned reads at your top DE genes before writing a single result. Most analysis bugs are visible here."
        tag: Tool
        url: "https://igv.org"
      - title: "nf-core/rnaseq — production pipeline"
        description: "Run it end-to-end at least once. It shows you what the steps are, in what order, with what defaults — and it handles the infrastructure so you focus on biology."
        tag: Pipeline
        url: "https://nf-co.re/rnaseq"

  - type: webinars
    resources:
      - title: "Accessing Multi-Omics Data for Tumour Profiling"
        description: "A practical walkthrough of integrating genomics data types for a real clinical question — good for seeing how the tools you're learning connect in practice."
        tag: Webinar
        webinarSlug: accessing-multi-omics-data-tumour-profiling-aashil-batavia
      - title: "Short Tandem Repeats in Tumours & Immunotherapy"
        description: "How a specific genomic feature — repeat instability — becomes a clinical biomarker. A concrete example of genomics moving from methods to medicine."
        tag: Webinar
        webinarSlug: short-tandem-repeats-tumours-immunotherapy
---
