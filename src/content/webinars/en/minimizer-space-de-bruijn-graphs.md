---
title: "Minimizer-space de Bruijn Graphs"
date: 2021-06-25
speaker: "Barış Ekim"
speakerAffiliation: "Massachusetts Institute of Technology"
description: "Barış Ekim introduces minimizer-space sequencing data analysis (mdBG), achieving orders-of-magnitude improvements in genome assembly speed and memory usage over existing methods."
youtubeUrl: ""
slidesUrl: ""
year: 2021
type: "bioinfonet"
image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774197082/rsgturkey/06/baris_480.jpg"
---

**Presenter**

**Barış Ekim**

Barış Ekim is a PhD student in Electrical Engineering and Computer Science (EECS) at Massachusetts Institute of Technology, under the supervision of Bonnie Berger. He graduated with a double major in Computer Science and Molecular Biology and Mathematics from MIT in 2020. His research focuses on designing efficient and accurate algorithms and developing software for next-generation sequencing (NGS) data, with a general interest in novel algorithms for applications in bioinformatics and computational genomics.

**Abstract**

DNA sequencing data continues to progress towards longer reads with increasingly lower sequencing error rates. We focus on the problem of assembling such reads into genomes — a challenge in terms of accuracy and computational resources when using cutting-edge assembly approaches based on overlapping reads using minimizer sketches.

Here, we introduce the concept of **minimizer-space sequencing data analysis**, where the minimizers rather than DNA nucleotides are the atomic tokens of the alphabet. By projecting DNA sequences into ordered lists of minimizers, our key idea is to enumerate what we call k-min-mers — k-mers over a larger alphabet consisting of minimizer tokens. Our approach, **mdBG** (minimizer-space de Bruijn Graph), achieves orders-of-magnitude improvement in both speed and memory usage over existing methods without much loss of accuracy.

We demonstrate three use cases of mdBG:

- **Human genome assembly** — A human genome assembled in under 10 minutes using 8 cores and 10 GB RAM
- **Metagenome assembly** — 60 Gbp of metagenome reads assembled in 4 minutes using 1 GB RAM
- **Pangenome representation** — A graphical representation of 661,405 bacterial genomes, successfully searchable for antimicrobial resistance (AMR) genes in minimizer-space

We implemented mdBG in software called **rust-mdbg**, resulting in ultra-fast, low-memory and highly-contiguous assembly of PacBio HiFi reads. Given the rise of long-read sequencing in genomics, metagenomics, and pangenomics, we expect these advances to be essential to sequence analysis.

**Date:** June 25th, 2021 — 20:00 (GMT+3)

**Language:** English
