---
domain: ml
level: specialist
orientation: "You're at or near the frontier. This level covers the current generation of models, the evaluation landscape, and the papers from the last two years that have moved the field."
prerequisites:
  - Published or presented bio-ML work
  - Comfortable reading ICLR / NeurIPS / Nature Methods papers critically
  - Understand attention mechanisms and transformers in depth
sections:
  - type: foundations
    resources:
      - title: "Protein Language Models: what they learn and what they don't"
        description: "ESM, ProtTrans, Ankh — a comparative analysis of what these models actually encode. The benchmark numbers matter less than understanding why a model generalises to a new task."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-024-02212-x"
      - title: "Geometric Deep Learning for molecular data"
        description: "Equivariance, SE(3)-transformers, and why 3D structure requires a different inductive bias than sequences. The mathematical framing that unifies most modern structure-based models."
        tag: Reading
        url: "https://geometricdeeplearning.com"

  - type: toolkit
    resources:
      - title: "ESM-3 — multimodal protein language model"
        description: "Sequence, structure, and function in a single model. The current frontier for protein representation. The API is accessible even without large compute."
        tag: Tool
        url: "https://github.com/evolutionaryscale/esm"
      - title: "RFdiffusion / ProteinMPNN — protein design"
        description: "Diffusion-based backbone generation followed by sequence design. The practical toolkit for de novo protein design — if you're doing generative work, start here."
        tag: Tool
        url: "https://github.com/RosettaCommons/RFdiffusion"
      - title: "DiffDock — structure-based docking with diffusion"
        description: "Treats docking as a diffusion process over ligand poses. Outperforms AutoDock Vina on blind benchmarks. The new baseline for structure-based drug design."
        tag: Tool
        url: "https://github.com/gcorso/DiffDock"
      - title: "PyTorch Geometric — GNNs for molecular data"
        description: "At specialist level, GNNs are often the right architecture for molecular property prediction. PyG has the widest ecosystem of molecular datasets and pre-built layers."
        tag: Tool
        url: "https://pytorch-geometric.readthedocs.io"

  - type: webinars
    resources:
      - title: "Reconstruction of Signaling Network Topology"
        description: "ML-based network inference applied to signalling biology. A technically dense talk that demonstrates how graph-based models handle biological network data."
        tag: Webinar
        webinarSlug: reconstruction-signaling-network-topology
      - title: "CEN Tools — Integrative Platform for Essential Genes"
        description: "Multi-omics integration for essentiality prediction. Relevant if you work on target identification, CRISPR screen analysis, or multi-modal data fusion."
        tag: Webinar
        webinarSlug: cen-tools-integrative-platform-essential-genes

  - type: papers
    resources:
      - title: "ESM-3: Simulating 500 million years of evolution with a language model (Hayes et al. 2024)"
        description: "The paper that unified sequence, structure, and function in a single generative model. Read for the training objective and the generation experiments — not just the benchmarks."
        tag: Paper
        url: "https://www.evolutionaryscale.ai/papers/esm3-simulating-500-million-years-of-evolution"
      - title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3 (Abramson et al. 2024)"
        description: "AF3 extends AlphaFold to protein-DNA, protein-RNA, and protein-ligand complexes. The diffusion-based architecture is a significant departure from AF2."
        tag: Paper
        url: "https://www.nature.com/articles/s41586-024-07487-w"
      - title: "DiffDock: Diffusion Steps, Twists, and Turns for Molecular Docking (Corso et al. 2022)"
        description: "Treating molecular docking as a diffusion process over the product space of ligand poses. The paper that replaced AutoDock Vina as the benchmark to beat."
        tag: Paper
        url: "https://arxiv.org/abs/2210.01776"
---
