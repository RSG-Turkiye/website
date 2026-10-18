---
domain: ml
level: specialist
orientation: "Sınırda veya sınıra yakınsınız. Bu seviye mevcut model neslini, değerlendirme manzarasını ve son iki yılda alanı ileriye taşıyan makaleleri kapsar."
prerequisites:
  - Bio-ML çalışması yayınladınız veya sundunuz
  - ICLR / NeurIPS / Nature Methods makalelerini eleştirel bir gözle okuyabiliyorsunuz
  - Dikkat mekanizmalarını ve transformerları derinlemesine anlıyorsunuz
sections:
  - type: foundations
    resources:
      - id: "ml-specialist-foundations-0"
        title: "Protein Language Models: what they learn and what they don't"
        description: "ESM, ProtTrans, Ankh: bu modellerin gerçekte neyi kodladığının karşılaştırmalı analizi. Kıyaslama sayıları, bir modelin neden yeni bir göreve genellediğini anlamaktan daha az önemli."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-024-02212-x"
      - id: "ml-specialist-foundations-1"
        title: "Geometric Deep Learning for molecular data"
        description: "Eşvaryans, SE(3)-transformerlar ve neden 3B yapının dizilerden farklı bir tümevarımsal önyargı gerektirdiği. Modern yapı tabanlı modellerin çoğunu birleştiren matematiksel çerçeve."
        tag: Reading
        url: "https://geometricdeeplearning.com"

  - type: toolkit
    resources:
      - id: "ml-specialist-toolkit-0"
        title: "ESM-3, multimodal protein language model"
        description: "Tek bir modelde dizi, yapı ve işlev. Protein temsili için mevcut sınır. API, büyük hesaplama olmadan bile erişilebilir."
        tag: Tool
        url: "https://github.com/evolutionaryscale/esm"
      - id: "ml-specialist-toolkit-1"
        title: "RFdiffusion / ProteinMPNN, protein design"
        description: "Diffüzyon tabanlı iskelet oluşturmanın ardından dizi tasarımı. De novo protein tasarımı için pratik araç seti, üretici çalışma yapıyorsanız buradan başlayın."
        tag: Tool
        url: "https://github.com/RosettaCommons/RFdiffusion"
      - id: "ml-specialist-toolkit-2"
        title: "DiffDock, structure-based docking with diffusion"
        description: "Kenetlenmeyi ligand pozları üzerinde bir diffüzyon süreci olarak ele alır. Kör kıyaslamalarda AutoDock Vina'yı geçiyor. Yapı tabanlı ilaç tasarımı için yeni temel."
        tag: Tool
        url: "https://github.com/gcorso/DiffDock"
      - id: "ml-specialist-toolkit-3"
        title: "PyTorch Geometric, GNNs for molecular data"
        description: "Uzman seviyesinde, GNN'ler genellikle moleküler özellik tahmini için doğru mimaridir. PyG'nin moleküler veri setleri ve önceden oluşturulmuş katmanlar için en geniş ekosistemi var."
        tag: Tool
        url: "https://pytorch-geometric.readthedocs.io"

  - type: webinars
    resources:
      - id: "ml-specialist-webinars-0"
        title: "CEN Tools, Integrative Platform for Essential Genes"
        description: "Esansiyallik tahmini için çok-omik entegrasyonu. Hedef belirleme, CRISPR ekranı analizi veya çok-modal veri füzyonu üzerinde çalışıyorsanız ilgili."
        tag: Webinar
        webinarSlug: cen-tools-integrative-platform-essential-genes

  - type: papers
    resources:
      - id: "ml-specialist-papers-0"
        title: "ESM-3: Simulating 500 million years of evolution with a language model (Hayes et al. 2024)"
        description: "Dizi, yapı ve işlevi tek bir üretici modelde birleştiren makale. Eğitim hedefi ve üretim deneyleri için okuyun, sadece kıyaslamalara bakmayın."
        tag: Paper
        url: "https://www.evolutionaryscale.ai/blog/esm3-release"
      - id: "ml-specialist-papers-1"
        title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3 (Abramson et al. 2024)"
        description: "AF3, AlphaFold'u protein-DNA, protein-RNA ve protein-ligand komplekslerine genişletiyor. Diffüzyon tabanlı mimari, AF2'den önemli bir ayrılma."
        tag: Paper
        url: "https://www.nature.com/articles/s41586-024-07487-w"
      - id: "ml-specialist-papers-2"
        title: "DiffDock: Diffusion Steps, Twists, and Turns for Molecular Docking (Corso et al. 2022)"
        description: "Moleküler kenetlenmeyi ligand pozlarının ürün uzayı üzerinde bir diffüzyon süreci olarak ele almak. AutoDock Vina'yı yenilecek kıyaslama olarak değiştiren makale."
        tag: Paper
        url: "https://arxiv.org/abs/2210.01776"
---
