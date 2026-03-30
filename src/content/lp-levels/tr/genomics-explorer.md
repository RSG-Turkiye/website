---
domain: genomics
level: explorer
orientation: "Genomiğin ne olduğunu ve bununla ne yapabileceğinizi anlamak istiyorsunuz. Bu seviye sıfır hesaplamalı deneyim gerektirmez — ama tamamladığınızda sırada ne öğreneceğinize dair gerçek bir karar verebileceksiniz."
prerequisites:
  - Temel biyoloji (DNA, RNA ve proteinlerin ne olduğunu biliyorsunuz)
sections:
  - type: foundations
    resources:
      - title: "How Sequencing Works — from Sanger to short-read"
        description: "Bir dizileme makinasının gerçekte ne ürettiği, neden okumalar kısa olduğu ve 'kapsama' ne anlama geldiği. Bu çerçeveleme, sonraki tüm araç kararlarını anlamlı kılar."
        tag: Reading
        url: "https://www.ebi.ac.uk/training/online/courses/functional-genomics-ii-common-technologies-and-data-analysis-methods/"
      - title: "What does RNA-seq actually measure?"
        description: "RNA-seq genleri ölçmez — transkriptleri sayar. Bu ayrımı anlamak, başlangıçta herkesi etkileyen bir yorum hatasını önler."
        tag: Reading
        url: "https://hbctraining.github.io/Intro-to-rnaseq-hpc-salmon-flipped/lessons/01_intro-to-RNAseq.html"
      - title: "What are Omics? (Genomics, Transcriptomics, Proteomics)"
        description: "Omik manzarasının sade dilli genel bakışı: her birinin neyi ölçtüğü, hangi soruları yanıtladığı ve neden birini diğerine tercih edeceğiniz."
        tag: Reading
        url: "https://www.ebi.ac.uk/training/online/courses/functional-genomics-ii-common-technologies-and-data-analysis-methods/"

  - type: toolkit
    resources:
      - title: "UCSC Genome Browser"
        description: "Açıklamalı genomları görsel olarak keşfedin — kod yok, kurulum yok. Herhangi bir gene gidin, ekzon yapısını, ifade verisini ve türler arası korunumunu görün."
        tag: Tool
        url: "https://genome.ucsc.edu/training/index.html"
      - title: "Galaxy Project — Analysis Without Code"
        description: "RNA-seq pipeline'larını web arayüzü üzerinden çalıştırın. Adımları kodlamadan önce gerçekte ne yaptıklarını anlamak için kullanın."
        tag: Platform
        url: "https://training.galaxyproject.org/training-material/topics/transcriptomics/"
      - title: "NCBI Databases — finding real data"
        description: "GenBank, GEO, SRA — NCBI dünyanın kamuya açık biyolojik verilerinin çoğuna ev sahipliği yapıyor. Baskı altında kullanmadan önce nasıl gezileceğini öğrenin."
        tag: Tutorial
        url: "https://www.ncbi.nlm.nih.gov/home/learn/"

  - type: webinars
    resources:
      - title: "Aspects of High-Throughput Molecular Data Analysis"
        description: "HT veri tipleri, ön işleme stratejileri ve yaygın analitik tuzakların geniş kapsamlı bir genel bakışı. Verinin gerçek bir laboratuvarda nasıl aktığının mükemmel bir ilk bakışı."
        tag: Webinar
        webinarSlug: aspects-of-high-throughput-molecular-data-analysis
      - title: "Big Data in Life Sciences"
        description: "Modern biyolojinin hesaplamalı düşünce gerektiren ölçeklerde nasıl veri ürettiği. Bir yön seçmeden önce alanın kapsamını anlamanızı sağlar."
        tag: Webinar
        speaker: "Nikolay Oskolkov"
        year: 2022
        webinarSlug: big-data-in-life-sciences-nikolay-oskolkov
---
