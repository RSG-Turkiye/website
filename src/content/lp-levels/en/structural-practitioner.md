---
domain: structural
level: practitioner
orientation: "You've visualised structures and understand secondary structure elements. This level covers the analytical core: molecular dynamics, docking, and how to move from a static structure to dynamics and binding."
prerequisites:
  - Can identify alpha helices and beta sheets in a structure viewer
  - Understand the concept of protein active sites and binding pockets
  - Comfortable running command-line tools
sections:
  - type: foundations
    resources:
      - title: "Molecular Dynamics: what you're actually simulating"
        description: "MD integrates Newton's equations of motion for every atom. Understanding the force field, timestep, and ensemble choices explains why two simulations of the same protein can give different answers."
        tag: Tutorial
        url: "https://www.gromacs.org/Documentation_of_outdated_versions/Tutorials/GROMACS_Tutorial_1_Lysozyme_in_Water"
      - title: "Molecular Docking: what the score means (and doesn't)"
        description: "Docking scores are not binding affinities. Understanding the scoring function — what it approximates and where it breaks down — prevents a very common category of over-interpretation."
        tag: Reading
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5983082/"
      - title: "Structure Quality: how to evaluate what you're working with"
        description: "Resolution, R-factor, B-factors, clashscore — a structure with poor quality metrics should not anchor your analysis. Learn to read the wwPDB validation report before trusting any PDB entry."
        tag: Reading
        url: "https://pdb101.rcsb.org/learn/guide-to-understanding-pdb-data/quality-filtering-and-checking"

  - type: toolkit
    resources:
      - title: "PyMOL — structural visualisation and analysis"
        description: "The standard tool for publication-quality structure figures and basic analyses. Free open-source version available. Learn the selection algebra — it's the foundation of all PyMOL scripting."
        tag: Tool
        url: "https://pymol.org/dokuwiki/doku.php?id=tutorials"
      - title: "GROMACS — molecular dynamics simulations"
        description: "The most widely used MD engine for protein simulations. Justin Lemkul's lysozyme-in-water tutorial is the canonical starting point — work through it before running your own system."
        tag: Tool
        url: "https://www.gromacs.org"
      - title: "AutoDock Vina — molecular docking"
        description: "Fast, free, and widely used for structure-based drug discovery. Understand the receptor preparation steps (hydrogens, charges) before docking — garbage-in applies here hard."
        tag: Tool
        url: "https://vina.scripps.edu"
      - title: "BioPython — PDB parsing and structure analysis"
        description: "Parse PDB files, extract residues, calculate distances, iterate over chains. The programmatic interface to structure data that you'll need for any batch analysis."
        tag: Tool
        url: "https://biopython.org/wiki/The_Biopython_Structural_Bioinformatics_FAQ"

  - type: webinars
    resources:
      - title: "Molecular Simulations"
        description: "Practical molecular dynamics — the setup, the pitfalls, and what you can extract from trajectories. Relevant directly to GROMACS/AMBER workflows."
        tag: Webinar
        webinarSlug: molecular-simulations
      - title: "Integrative Modeling of Biomolecular Complexes"
        description: "How to model assemblies that are too large or too flexible for X-ray crystallography alone. The integrative approach combines cryo-EM, crosslinking, and computational modelling."
        tag: Webinar
        webinarSlug: integrative-modeling-of-biomolecular-complexes
      - title: "Modeling RNA and Protein-RNA Complexes"
        description: "Extending structural methods to RNA and RNP complexes — the specific challenges (flexibility, ion interactions) that make RNA harder to model than proteins."
        tag: Webinar
        webinarSlug: modeling-rna-and-protein-rna-complexes
---
