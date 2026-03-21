---
title: Minimizer-space de Bruijn Graphs
pubDate: 2021-06-15
description: "Presenter Barış Ekim Baris Ekim is a PhD student in Electrical Engineering and Computer Science (EECS) at Massachusetts Institute of Technology, under the supervision of Bonnie Berger. He graduated with a double major in Computer Science and Molecular Biology and Mathematics from MIT in 2020, and partakes a general interest in developing novel algorithms for"
author: Engin Tatlıdil
category: general
tags: []
image: "https://secure.gravatar.com/avatar/3377e5bc75a5b51051befd9cf44b3353daf37f67d108a367b8629de676830b07?s=30&d=mm&r=g"
lang: "tr"
draft: false
---

**Presenter**

![](https://rsgturkey.com/wp-content/uploads/2021/06/baris_480.jpg)

**Barış Ekim**

Baris Ekim is a PhD student in Electrical Engineering and Computer Science (EECS) at Massachusetts Institute of Technology, under the supervision of Bonnie Berger. He graduated with a double major in Computer Science and Molecular Biology and Mathematics from MIT in 2020, and partakes a general interest in developing novel algorithms for applications in bioinformatics and computational genomics. More specifically, his research focuses on designing efficient and accurate algorithms and developing software for next-generation sequencing (NGS) data.

**Abstract**

DNA sequencing data continues to progress towards longer reads with increasingly lower sequencing error rates. We focus on the problem of assembling such reads into genomes, which poses challenges in terms of accuracy and computational resources when using cutting-edge assembly approaches, e.g. those based on overlapping reads using minimizer sketches. Here, we introduce the concept of minimizer-space sequencing data analysis, where the minimizers rather than DNA nucleotides are the atomic tokens of the alphabet. By projecting DNA sequences into ordered lists of minimizers, our key idea is to enumerate what we call k-min-mers, that are k-mers over a larger alphabet consisting of minimizer tokens. Our approach, mdBG or minimizer-dBG, achieves orders-of-magnitude improvement in both speed and memory usage over existing methods without much loss of accuracy. We demonstrate three uses cases of mdBG: human genome assembly, metagenome assembly, and the representation of large pangenomes. For assembly, we implemented mdBG in software we call rust-mdbg, resulting in ultra-fast, low memory and highly-contiguous assembly of PacBio HiFi reads. A human genome is assembled in under 10 minutes using 8 cores and 10 GB RAM, and 60 Gbp of metagenome reads are assembled in 4 minutes using 1 GB RAM. For pangenome graphs, we newly allow a graphical representation of a collection of 661,405 bacterial genomes as an mdBG and successfully search it (in minimizer-space) for anti-microbial resistance (AMR) genes. We expect our advances to be essential to sequence analysis, given the rise of long-read sequencing in genomics, metagenomics and pangenomics.

**Date:** June 25th, 2021 – 8:00 PM (GMT+3)

**Language:** English

> **To register the webinar, you can visit this link:**
> 
> [www.bigmarker.com/bioinfonet/Minimizer-space-de-Bruijn-Graphs](http://www.bigmarker.com/bioinfonet/Minimizer-space-de-Bruijn-Graphs)
