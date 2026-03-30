---
domain: genomics
level: explorer
orientation: "You want to understand what genomics is and what you can do with it. This level requires zero prior computational experience — but you'll leave it knowing enough to make a real decision about what to learn next."
prerequisites:
  - Basic biology (you know what DNA, RNA, and proteins are)
sections:
  - type: foundations
    resources:
      - title: "How Sequencing Works — from Sanger to short-read"
        description: "What a sequencing machine actually produces, why reads are short, and what 'coverage' means. This framing makes every downstream tool decision make sense."
        tag: Reading
        url: "https://www.ebi.ac.uk/training/online/courses/functional-genomics-ii-common-technologies-and-data-analysis-methods/"
      - title: "What does RNA-seq actually measure?"
        description: "RNA-seq doesn't measure genes — it counts transcripts. Understanding this distinction prevents a category of misinterpretation that haunts beginners."
        tag: Reading
        url: "https://hbctraining.github.io/Intro-to-rnaseq-hpc-salmon-flipped/lessons/01_intro-to-RNAseq.html"
      - title: "What are Omics? (Genomics, Transcriptomics, Proteomics)"
        description: "A plain-language overview of the -omics landscape: what each one measures, the kind of questions each answers, and why you'd choose one over another."
        tag: Reading
        url: "https://www.ebi.ac.uk/training/online/courses/functional-genomics-ii-common-technologies-and-data-analysis-methods/"

  - type: toolkit
    resources:
      - title: "UCSC Genome Browser"
        description: "Explore annotated genomes visually — no code, no install. Navigate to any gene, see its exon structure, expression data, and conservation across species."
        tag: Tool
        url: "https://genome.ucsc.edu/training/index.html"
      - title: "Galaxy Project — Analysis Without Code"
        description: "Run RNA-seq pipelines through a web interface. Use this to understand what the steps actually do before you script any of them."
        tag: Platform
        url: "https://training.galaxyproject.org/training-material/topics/transcriptomics/"
      - title: "NCBI Databases — finding real data"
        description: "GenBank, GEO, SRA — NCBI hosts most of the world's public biological data. Learn to navigate it before you need to use it under pressure."
        tag: Tutorial
        url: "https://www.ncbi.nlm.nih.gov/home/learn/"

  - type: webinars
    resources:
      - title: "Aspects of High-Throughput Molecular Data Analysis"
        description: "A broad overview of HT data types, preprocessing strategies, and common analytical pitfalls. An excellent first look at how data actually flows through a real lab."
        tag: Webinar
        webinarSlug: aspects-of-high-throughput-molecular-data-analysis
      - title: "Big Data in Life Sciences"
        description: "How modern biology generates data at scales that demand computational thinking. Gives you a sense of the field's scope before you commit to a direction."
        tag: Webinar
        speaker: "Nikolay Oskolkov"
        year: 2022
        webinarSlug: big-data-in-life-sciences-nikolay-oskolkov
---
