---
domain: structural
level: researcher
orientation: "You design structural analyses as part of research projects. This level covers integrative approaches, the AlphaFold ecosystem, and the landmark methods papers behind the tools you use."
prerequisites:
  - Have run at least one MD simulation end-to-end
  - Understand the concept of free energy and conformational sampling
  - Can critically evaluate a docking result
sections:
  - type: foundations
    resources:
      - title: "Cryo-EM: principles and what it gives you over X-ray"
        description: "Cryo-EM has become the dominant method for large complexes and flexible systems. Understanding the reconstruction pipeline — particle picking, 2D classes, 3D refinement — is now a core literacy for structural biologists."
        tag: Reading
        url: "https://www.ebi.ac.uk/training/online/courses/cryo-em-map-interpretation-in-protein-model-building/"
      - title: "Integrative Structural Biology: combining data types"
        description: "No single method gives you the full picture. How to combine cryo-EM, crosslinking-MS, SAXS, and computational modelling into a coherent structural model — and how to report the uncertainty."
        tag: Reading
        url: "https://www.cell.com/structure/fulltext/S0969-2126(19)30189-1"

  - type: toolkit
    resources:
      - title: "IMP — Integrative Modelling Platform"
        description: "The framework for integrative structural biology. Combines heterogeneous experimental data into a structural ensemble with uncertainty quantification."
        tag: Tool
        url: "https://integrativemodeling.org"
      - title: "AlphaFold2 Multimer — complex structure prediction"
        description: "AF2-Multimer predicts protein complex structures. Interpret pTM and ipTM scores carefully — they indicate model confidence, not binding affinity."
        tag: Tool
        url: "https://github.com/google-deepmind/alphafold"
      - title: "HADDOCK — data-driven docking"
        description: "Incorporates experimental data (NMR shifts, mutagenesis, crosslinks) as restraints in docking. More biologically grounded than blind docking when you have any prior knowledge."
        tag: Tool
        url: "https://www.bonvinlab.org/software/haddock2.2/"

  - type: webinars
    resources:
      - title: "Integrative Modeling of Biomolecular Complexes"
        description: "The IMP framework in practice — combining cryo-EM density, crosslinking, and other data into a structural model with quantified uncertainty."
        tag: Webinar
        webinarSlug: integrative-modeling-of-biomolecular-complexes
      - title: "Species-Specific Allosteric Drug Design"
        description: "How structural differences between species can be exploited for selective drug design. A sophisticated example of how structural knowledge translates into therapeutic strategy."
        tag: Webinar
        webinarSlug: species-specific-allosteric-drug-design
      - title: "Computational Challenges in Protein-RNA Interactions"
        description: "The structural and computational challenges specific to protein-RNA complexes — flexibility, electrostatics, and the limits of current force fields."
        tag: Webinar
        webinarSlug: computational-challenges-protein-rna

  - type: papers
    resources:
      - title: "AlphaFold2 (Jumper et al. 2021, Nature)"
        description: "Read it for the architecture and what the pLDDT score actually measures — not just the headline result. The sections on model confidence are particularly important for practical use."
        tag: Paper
        url: "https://www.nature.com/articles/s41586-021-03819-2"
      - title: "Integrative structure and functional anatomy of a nuclear pore complex (Kim et al. 2018)"
        description: "The definitive example of integrative structural biology applied to a large assembly. The methods section is a template for how to combine data types in a principled way."
        tag: Paper
        url: "https://www.nature.com/articles/nature26003"
      - title: "Impact of protein structure on evolution (Dutheil et al.)"
        description: "How structural constraints shape sequence evolution — and what that means for modelling the relationship between structure, function, and selection."
        tag: Paper
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6291155/"
---
