---
domain: ml
level: practitioner
orientation: "You've trained models and understand overfitting and cross-validation. Applying ML to biological data requires extra care — the data distributions, evaluation protocols, and failure modes are different from standard benchmark datasets."
prerequisites:
  - Trained at least one ML model (any framework)
  - Understand cross-validation and why train/test splits matter
  - Familiar with numpy, pandas, or equivalent data manipulation
sections:
  - type: foundations
    resources:
      - title: "Representations of Biological Sequences"
        description: "One-hot encoding, k-mers, embeddings — how you represent a sequence determines what a model can and can't learn from it. This is the most consequential modelling decision you'll make."
        tag: Course
        url: "https://www.ebi.ac.uk/training/online/courses/protein-bioinformatics/"
      - title: "Honest Evaluation in Bio-ML — avoiding data leakage"
        description: "Genomic data is not i.i.d. Sequence similarity between train and test sets inflates performance metrics. This paper is required reading before you report any benchmark number."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-021-01205-6"
      - title: "From CNNs to Transformers in Genomics"
        description: "The progression from DeepBind to Enformer to modern attention models. Understanding this history explains why the field made each architectural choice — and when older approaches still win."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-021-00434-9"

  - type: toolkit
    resources:
      - title: "PyTorch — the research framework"
        description: "De-facto standard for bio-ML research. Most modern papers use PyTorch. The official tutorials (60-minute blitz) are the fastest way to get productive."
        tag: Tool
        url: "https://pytorch.org/tutorials/beginner/deep_learning_60min_blitz.html"
      - title: "BioPython — sequence data handling"
        description: "Parsing FASTA/FASTQ, accessing NCBI, working with sequence records. The plumbing that sits between raw biological data and your ML pipeline."
        tag: Tool
        url: "https://biopython.org/wiki/Documentation"
      - title: "scikit-learn — your baseline for every experiment"
        description: "Before you reach for PyTorch, fit a gradient-boosted tree. If the simple model performs comparably, the complex model isn't justified."
        tag: Tool
        url: "https://scikit-learn.org"

  - type: webinars
    resources:
      - title: "Language Models for Protein Properties"
        description: "How protein language models are trained, what they encode, and how to use pre-trained embeddings as features. A conceptual foundation before you touch ESM or ProtTrans code."
        tag: Webinar
        webinarSlug: language-models-protein-properties
      - title: "HERCULES — Long-read Error Correction"
        description: "A worked example of ML applied to a specific bioinformatics problem: correcting sequencing errors in long reads. Shows the full ML workflow from problem formulation to evaluation."
        tag: Webinar
        webinarSlug: hercules-long-read-error-correction
      - title: "Big Data in Life Sciences"
        description: "Scalability challenges in bio-ML — when your data doesn't fit in RAM and your model doesn't converge on a single GPU."
        tag: Webinar
        speaker: "Nikolay Oskolkov"
        year: 2022
        webinarSlug: big-data-in-life-sciences-nikolay-oskolkov
---
