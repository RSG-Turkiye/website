---
domain: genomics
level: specialist
orientation: "Yayınlıyorsunuz veya yayınlamaya hazırlanıyorsunuz. Bu seviye uzun okuma teknolojilerini, tek hücre çok-omik'i ve son üç yılda alanı ileriye taşıyan araç ve makaleleri kapsar."
prerequisites:
  - scRNA-seq analizi çalıştırdınız (Seurat veya Scanpy)
  - Batch düzeltme ve entegrasyon yöntemlerini kavramsal olarak anlıyorsunuz
  - Yöntemler makalelerini rahatça okuyorsunuz — istatistiksel iddiaları değerlendirebiliyorsunuz
sections:
  - type: foundations
    resources:
      - title: "Long-read sequencing: what changes with Nanopore and PacBio"
        description: "Uzun okumalar, kısa okumaların çözemediği problemleri çözer — tam izoform çözünürlüğü, yapısal varyantlar, tekrar bölgeleri. Bu inceleme analitik manzarayı haritalıyor."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-023-00586-w"
      - title: "Single-cell multi-omics: joint profiling of RNA and chromatin"
        description: "CITE-seq, ATAC+RNA, uzamsal çok-omik — hücre başına birden fazla modalite ölçmek, sorabildiğiniz soruları değiştiriyor. Bu inceleme mevcut entegrasyon yöntemlerini kapsar."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-023-00586-w"

  - type: toolkit
    resources:
      - title: "ArchR / Signac — single-cell ATAC-seq"
        description: "scATAC-seq analizi, scRNA-seq'den farklı bir zihinsel model gerektirir. ArchR (R) ve Signac (R, Seurat entegreli) baskın araçlardır — her ikisinin de mükemmel vignette'leri var."
        tag: Tool
        url: "https://www.archrproject.com"
      - title: "scVI / scANVI — probabilistic single-cell integration"
        description: "Veri setlerini koşullar, donörler ve batch'ler arasında entegre etmek için derin üretici modeller. Büyük, heterojen kohortlar için CCA tabanlı yaklaşımlardan daha ilkeli."
        tag: Tool
        url: "https://scvi-tools.org"
      - title: "Minimap2 — long-read alignment"
        description: "Uzun okumalar için standart hizalayıcı. DNA vs. RNA (splice-aware), Nanopore vs. PacBio için farklı parametre profilleri. Ayarlamadan önce hazır ayarları bilin."
        tag: Tool
        url: "https://github.com/lh3/minimap2"
      - title: "Snakemake — workflow management for custom pipelines"
        description: "nf-core tam olarak ihtiyacınızı karşılamadığında kendi pipeline'ınızı yazarsınız. Snakemake'in kural tabanlı modeli, tek seferlik araştırma iş akışları için Nextflow'dan daha kolay anlaşılır."
        tag: Tool
        url: "https://snakemake.readthedocs.io"

  - type: webinars
    resources:
      - title: "Predictive Cell-Specific Gene Regulatory Models"
        description: "Düzenleyici genomiğin sınırı: hücre tipi çözünürlüğünde dizi özelliklerinden gen ifadesini tahmin eden modeller. Enhancer, TF bağlanması veya gen düzenlemesi üzerine herhangi bir çalışmayla doğrudan ilgili."
        tag: Webinar
        webinarSlug: predictive-cell-specific-gene-regulatory-models
      - title: "Mapping Human Tissue Architecture — Spatial Transcriptomics"
        description: "Cell2location ve pratik uzamsal dekonvolüsyon. Uzamsal veriyle çalışıyorsanız, yöntemi geliştiren gruptan dinleyin."
        tag: Webinar
        speaker: "Dr. Ömer Ali Bayraktar"
        year: 2023
        webinarSlug: mapping-human-tissue-architecture-and-pathology-using-spatial-transcriptomics

  - type: papers
    resources:
      - title: "Weighted nearest-neighbour analysis for single-cell multimodal data (Hao et al. 2021)"
        description: "Seurat v4'ün ortak RNA+protein veya RNA+ATAC analizi için WNN çerçevesi. Herhangi bir çok-modal tek hücre deneyi için kullanacağınız yöntem."
        tag: Paper
        url: "https://www.cell.com/cell/fulltext/S0092-8674(21)00583-3"
      - title: "Deep generative modelling for single-cell transcriptomics — scVI (Lopez et al. 2018)"
        description: "Varyasyonel otokodlayıcıları tek hücre genomiğine tanıtan makale. scVI'nın veri setlerini 'entegre' ederken gerçekte ne yaptığını anlamak için okuyun."
        tag: Paper
        url: "https://www.nature.com/articles/s41592-018-0229-2"
      - title: "Cell2location maps fine-grained cell types in spatial transcriptomics (Kleshchevnikov et al. 2022)"
        description: "Uzamsal transkriptomik verinin Bayesian dekonvolüsyonu. Visium veya benzeriyle çalışıyorsanız, anlamanız gereken yöntem makalesi budur."
        tag: Paper
        url: "https://www.nature.com/articles/s41587-021-01139-4"
---
