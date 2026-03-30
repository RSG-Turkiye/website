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
      - title: "Protein Language Models: what they learn and what they don't"
        description: "ESM, ProtTrans, Ankh — bu modellerin gerçekte neyi kodladığının karşılaştırmalı analizi. Kıyaslama sayıları, bir modelin neden yeni bir göreve genellediğini anlamaktan daha az önemli."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-024-02212-x"
      - title: "Geometric Deep Learning for molecular data"
        description: "Eşvaryans, SE(3)-transformerlar ve neden 3B yapının dizilerden farklı bir tümevarımsal önyargı gerektirdiği. Modern yapı tabanlı modellerin çoğunu birleştiren matematiksel çerçeve."
        tag: Reading
        url: "https://geometricdeeplearning.com"

  - type: toolkit
    resources:
      - title: "ESM-3 — multimodal protein language model"
        description: "Tek bir modelde dizi, yapı ve işlev. Protein temsili için mevcut sınır. API, büyük hesaplama olmadan bile erişilebilir."
        tag: Tool
        url: "https://github.com/evolutionaryscale/esm"
      - title: "RFdiffusion / ProteinMPNN — protein design"
        description: "Diffüzyon tabanlı iskelet oluşturmanın ardından dizi tasarımı. De novo protein tasarımı için pratik araç seti — üretici çalışma yapıyorsanız buradan başlayın."
        tag: Tool
        url: "https://github.com/RosettaCommons/RFdiffusion"
      - title: "DiffDock — structure-based docking with diffusion"
        description: "Kenetlenmeyi ligand pozları üzerinde bir diffüzyon süreci olarak ele alır. Kör kıyaslamalarda AutoDock Vina'yı geçiyor. Yapı tabanlı ilaç tasarımı için yeni temel."
        tag: Tool
        url: "https://github.com/gcorso/DiffDock"
      - title: "PyTorch Geometric — GNNs for molecular data"
        description: "Uzman seviyesinde, GNN'ler genellikle moleküler özellik tahmini için doğru mimaridir. PyG'nin moleküler veri setleri ve önceden oluşturulmuş katmanlar için en geniş ekosistemi var."
        tag: Tool
        url: "https://pytorch-geometric.readthedocs.io"

  - type: webinars
    resources:
      - title: "Reconstruction of Signaling Network Topology"
        description: "Sinyal biyolojisine uygulanan ML tabanlı ağ çıkarımı. Graf tabanlı modellerin biyolojik ağ verisini nasıl işlediğini gösteren teknik yoğun bir konuşma."
        tag: Webinar
        webinarSlug: reconstruction-signaling-network-topology
      - title: "CEN Tools — Integrative Platform for Essential Genes"
        description: "Esansiyallik tahmini için çok-omik entegrasyonu. Hedef belirleme, CRISPR ekranı analizi veya çok-modal veri füzyonu üzerinde çalışıyorsanız ilgili."
        tag: Webinar
        webinarSlug: cen-tools-integrative-platform-essential-genes

  - type: papers
    resources:
      - title: "ESM-3: Simulating 500 million years of evolution with a language model (Hayes et al. 2024)"
        description: "Dizi, yapı ve işlevi tek bir üretici modelde birleştiren makale. Eğitim hedefi ve üretim deneyleri için okuyun — sadece kıyaslamalara bakmayın."
        tag: Paper
        url: "https://www.evolutionaryscale.ai/papers/esm3-simulating-500-million-years-of-evolution"
      - title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3 (Abramson et al. 2024)"
        description: "AF3, AlphaFold'u protein-DNA, protein-RNA ve protein-ligand komplekslerine genişletiyor. Diffüzyon tabanlı mimari, AF2'den önemli bir ayrılma."
        tag: Paper
        url: "https://www.nature.com/articles/s41586-024-07487-w"
      - title: "DiffDock: Diffusion Steps, Twists, and Turns for Molecular Docking (Corso et al. 2022)"
        description: "Moleküler kenetlenmeyi ligand pozlarının ürün uzayı üzerinde bir diffüzyon süreci olarak ele almak. AutoDock Vina'yı yenilecek kıyaslama olarak değiştiren makale."
        tag: Paper
        url: "https://arxiv.org/abs/2210.01776"
---
