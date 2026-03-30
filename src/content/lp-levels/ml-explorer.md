---
domain: ml
level: explorer
orientation: "You know one side of this field — either you write code and understand models, or you work with biological data but haven't applied ML yet. The language and the framing are different from both pure ML and pure biology. Start here."
prerequisites:
  - "One of: basic Python/R, OR basic molecular biology"
sections:
  - type: foundations
    resources:
      - title: "StatQuest — Statistics and ML for Biologists"
        description: "If you're coming from biology: this is the gentlest rigorous introduction to the concepts that ML is built on. Watch the probability and linear models series before anything else."
        tag: Videos
        url: "https://www.youtube.com/@statquest"
      - title: "Why Biology Needs ML — and why it's hard (Nature Methods)"
        description: "Biological data is high-dimensional, sparse, and structured in ways that break standard ML assumptions. Reading this first saves you from a category of mistakes that afflicts every biologist-turned-ML-practitioner."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-021-01333-z"
      - title: "fast.ai Practical Deep Learning — Part 1"
        description: "If you're coming from CS/ML: the best top-down introduction to deep learning. Get to chapter 4 (NLP) before branching into biology-specific content."
        tag: Course
        url: "https://course.fast.ai"

  - type: toolkit
    resources:
      - title: "Google Colab — free GPUs for your first experiments"
        description: "No local setup, no GPU required. Run your first neural network on biological data in a browser. Every bio-ML tutorial worth following has a Colab link."
        tag: Platform
        url: "https://colab.research.google.com"
      - title: "scikit-learn — start here, not with deep learning"
        description: "Decision trees, random forests, SVMs — if your problem can be solved without a GPU, solve it this way first. Most biology problems can be meaningfully addressed with classical ML."
        tag: Tool
        url: "https://scikit-learn.org/stable/tutorial/"
      - title: "Kaggle Learn — ML fundamentals"
        description: "Short, interactive courses on pandas, ML fundamentals, and feature engineering. Good for closing gaps if you know biology but haven't worked with data programmatically."
        tag: Interactive
        url: "https://www.kaggle.com/learn"

  - type: webinars
    resources:
      - title: "Early Detection of Skin Cancer with Deep Learning"
        description: "A complete end-to-end case study: from raw images to a clinical-grade classifier. The clearest example of ML solving a real biological problem in the RSG Turkey archive."
        tag: Webinar
        webinarSlug: early-detection-skin-cancer-deep-learning-vidit-go
      - title: "Big Data in Life Sciences"
        description: "The scope of computational biology. This talk gives you a sense of the scale and diversity of problems that ML is being applied to — useful orientation before you pick a direction."
        tag: Webinar
        speaker: "Nikolay Oskolkov"
        year: 2022
        webinarSlug: big-data-in-life-sciences-nikolay-oskolkov
---
