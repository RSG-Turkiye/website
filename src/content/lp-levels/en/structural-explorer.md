---
domain: structural
level: explorer
orientation: "Protein structure is one of the most intuitive entry points in all of computational biology — a 3D shape you can rotate, measure, and interrogate. This level gives you the vocabulary and the first tools before anything quantitative."
prerequisites:
  - Understand what proteins are (amino acids chain → folded shape → function)
sections:
  - type: foundations
    resources:
      - title: "PDB-101: Introduction to Biological Macromolecules"
        description: "The Protein Data Bank's own learning resource. Molecule of the Month articles explain specific proteins visually and accessibly — read three of them before anything else."
        tag: Reading
        url: "https://pdb101.rcsb.org/learn/guide-to-understanding-pdb-data/introduction"
      - title: "Why Does Structure Matter? Sequence → Structure → Function"
        description: "The central axiom of structural biology. Understanding why two proteins with similar sequences can have different functions — or why distant homologs share a fold — motivates every structural analysis."
        tag: Reading
        url: "https://www.nature.com/scitable/topicpage/protein-structure-14122136/"
      - title: "The Protein Data Bank — how to navigate it"
        description: "RCSB PDB hosts every experimentally determined protein structure. Learn to search by gene name, read the structure summary page, and understand the quality metrics (resolution, R-factor)."
        tag: Tutorial
        url: "https://www.rcsb.org/docs/general-help/organization-of-3d-structures-in-the-protein-data-bank"

  - type: toolkit
    resources:
      - title: "Mol* — visualise any structure in your browser"
        description: "No installation required. Open any PDB entry and rotate, colour by chain, zoom into an active site. The first tool every structural biologist should know."
        tag: Tool
        url: "https://molstar.org/viewer/"
      - title: "ColabFold — predict a structure without a GPU"
        description: "AlphaFold2 in a Google Colab notebook. Paste a protein sequence, get a predicted structure in minutes. The AlphaFold era means any protein can now have a structural hypothesis."
        tag: Tool
        url: "https://github.com/sokrypton/ColabFold"

  - type: webinars
    resources:
      - title: "Molecular Simulations"
        description: "An accessible introduction to molecular dynamics — what you're simulating, what the energy function represents, and what you can learn from trajectories. Good conceptual grounding before touching GROMACS."
        tag: Webinar
        webinarSlug: molecular-simulations
      - title: "Integrative Modeling of Biomolecular Complexes (2018)"
        description: "The first RSG Turkey webinar on structural biology. Covers the big questions: how do we model large assemblies that can't be crystallised? A good orientation to the field's scope."
        tag: Webinar
        webinarSlug: first-webinar-2018-integrative-modeling
---
