---
domain: ml
level: researcher
orientation: "You design ML experiments for biological questions. This level covers the architectural landscape, the tools that define current bio-ML, and the landmark papers you need to have read."
prerequisites:
  - Built and evaluated a bio-ML model end-to-end
  - Understand attention mechanisms at a conceptual level
  - Can write and debug PyTorch training loops
sections:
  - type: foundations
    resources:
      - title: "Why Biology Needs ML — and the hard part"
        description: "Biological data is high-dimensional, noisy, and structured. Understanding this shapes every modelling decision — especially what you should and shouldn't expect your model to learn."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-021-01333-z"
      - title: "Representations of Biological Sequences"
        description: "One-hot, k-mer features, embeddings from language models — the representation is the model's view of the world. This course maps the options and their trade-offs."
        tag: Course
        url: "https://www.ebi.ac.uk/training/online/courses/protein-bioinformatics/"
      - title: "From CNNs to Transformers in Genomics"
        description: "The progression from DeepBind and Basenji to attention-based models. Architecture choices have biological consequences — this review traces why the field made each transition."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-021-00434-9"
      - title: "Honest Evaluation in Bio-ML"
        description: "Genomic splits are not i.i.d. Data leakage ruins papers. How to design evaluations that actually reflect real-world generalisation."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-021-01205-6"

  - type: toolkit
    resources:
      - title: "ESM-2 / Protein Language Models (Meta)"
        description: "Pre-trained on evolutionary sequences — embeddings that encode function without labels. The starting point for any protein property prediction task."
        tag: Tool
        url: "https://github.com/facebookresearch/esm"
      - title: "AlphaFold2 / ColabFold — structure from sequence"
        description: "ColabFold makes AF2 accessible without a GPU cluster. Run a structure prediction before designing any model that takes sequence as input — it changes what you'll try."
        tag: Tool
        url: "https://github.com/sokrypton/ColabFold"
      - title: "PyTorch Geometric / DGL — Graph Neural Networks"
        description: "Essential for molecular property prediction, protein-protein interaction modelling, and any task where your data is naturally a graph."
        tag: Tool
        url: "https://pytorch-geometric.readthedocs.io"
      - title: "scikit-learn — always run the baseline"
        description: "At researcher level, the baseline is not optional. It's the falsification check. Your deep learning model should meaningfully outperform a tuned gradient-boosted tree or it's not ready."
        tag: Tool
        url: "https://scikit-learn.org"

  - type: webinars
    resources:
      - title: "Language Models for Protein Properties"
        description: "How protein language models encode evolutionary and functional information. Watch this before implementing any ESM-based approach."
        tag: Webinar
        webinarSlug: language-models-protein-properties
      - title: "Early Detection of Skin Cancer with Deep Learning"
        description: "CNN applied to medical imaging — from raw images to clinical-grade classifiers. A clean end-to-end case study for how ML decisions translate to biological impact."
        tag: Webinar
        webinarSlug: early-detection-skin-cancer-deep-learning-vidit-go
      - title: "CEN Tools — Integrative Platform for Essential Genes"
        description: "ML-based integration of multi-omics data to predict gene essentiality. A worked example of how to combine data sources meaningfully."
        tag: Webinar
        webinarSlug: cen-tools-integrative-platform-essential-genes

  - type: papers
    resources:
      - title: "AlphaFold2 (Jumper et al. 2021, Nature)"
        description: "Read it to understand the architecture and what AF2 actually predicts — the confidence metrics, the training objective, and where the model still fails."
        tag: Paper
        url: "https://www.nature.com/articles/s41586-021-03819-2"
      - title: "Evolutionary-scale prediction with ESM-2 (Lin et al. 2023, Science)"
        description: "Protein language models at scale. The conceptual leap from NLP to protein function prediction — and the empirical results that made the field take notice."
        tag: Paper
        url: "https://www.science.org/doi/10.1126/science.ade2574"
      - title: "Opportunities and obstacles for DL in genomics (Eraslan et al. 2019)"
        description: "A critical, balanced review of where deep learning helps in genomics and where it doesn't. Required before starting any bio-ML project — read the 'obstacles' section twice."
        tag: Paper
        url: "https://www.nature.com/articles/s41576-019-0122-6"
---
