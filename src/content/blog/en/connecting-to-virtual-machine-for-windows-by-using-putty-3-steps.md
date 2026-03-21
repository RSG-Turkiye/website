---
title: Connecting to Virtual Machine for Windows by using Putty (3-steps)
pubDate: 2020-04-09
description: "Big data requires big infrastructure. If your computer cannot handle with big data, you need to connect with a server or virtual machine to store and process your data. I have been participating COVID19-bh20. If you are newbie like me to participate such events, and inexperienced in handling with big data in such a big"
author: Fatma Betul Dincaslan
category: general
tags: []
image: "https://secure.gravatar.com/avatar/07ce4a41d2f51fc1f2b8058aa368436436945ba7539bbd1287aa4aa89dbc8ae8?s=30&d=mm&r=g"
lang: "en"
draft: false
---

Big data requires big infrastructure. If your computer cannot handle with big data, you need to connect with a server or virtual machine to store and process your data.

I have been participating [COVID19-bh20](https://github.com/virtual-biohackathons). If you are newbie like me to participate such events, and inexperienced in handling with big data in such a big hackathon, here is the first thing you need to know about how to manage such metadata: connecting the Virtual Machine (VM) via Putty.

-   First you need to download [PuTTy](https://putty.org/)
-   Please open the putty key generator,

## Step-1

-   You need to generate the public and private keys in the format requested by the admin such as RSA format, shown in **yellow box**
-   You need to save them
-   After generation, you need to share the public key, shown in **red box**, with the admin of virtual machine/server
-   Btw you need to generate a password, which is shown with **green box**

![](http://rsgturkey.com/wp-content/uploads/2020/04/Generation.png)

## Step-2

-   Next type the IP address to the host name/IP address box, shown in **purple box**
-   **(Do not open without changing the Connection settings, which will be done in the following steps)**
-   Then you will enter the private key to access to VM via changing the Connection settings, shown with an **orange arrow**

![](http://rsgturkey.com/wp-content/uploads/2020/04/Host.png)

## Step-3

-   After clicking the _Connection_, denoted with **orange arrow**
-   Next step is to click _SSH_, shown in **orange arrow**
-   Then you need to click select _Auth_, shown in **orange arrow**
-   When you select Auth, you need to add the path of the private key via browsing it, shown in **red box**
-   Now you need to click **OPEN** to access, shown in green arrow

![](http://rsgturkey.com/wp-content/uploads/2020/04/Process-1024x437.png)

-   Username is given by the admin **username**@IP\_address, highlighted with bold
-   And the password will be the password you generated as key passphrase while generating the key.

I hope you find this post useful,

For detailed information you can check with [Microsoft Azure page](https://docs.microsoft.com/en-us/azure/virtual-machines/linux/ssh-from-windows).

PS: Although my labmates showed me how to do it before, I forgot it. Thanks to hackathon, I had a chance to refresh my old memories. In case you are a newbie like me, this post might be useful.

All the best with your analysis!
