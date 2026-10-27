---
title: Connect Claude to the panel
roles:
  - all
order: 1
---

If you connect Claude (or another AI assistant) to the panel, it can prepare drafts in your name. You are the one who publishes, never Claude.

## Connecting

1. Open claude.ai, then follow **Customize**, **Connectors**, **Add custom connector**.
2. Paste `https://rsg-turkiye.iscbsc.org/api/mcp` and leave the OAuth settings empty.
3. Press **Add**, then **Connect**.
4. Sign in with Google on this site, tick the areas and levels, choose how long, and press **Allow**.
5. It then works in the Claude desktop and mobile apps too.

Claude cannot reach further than your roles. When one of your roles ends, Claude loses that area at once.

## What you can ask

- Write, save and submit content or social media drafts for approval.
- Read published content and your own drafts.
- If you are an approver, Claude may also read the team's drafts, read only.

Example requests:

- "Prepare an event draft for this week's webinar and submit it for approval."
- "List the titles of our published blog posts."
- "Shorten the text of this Instagram post and save it as a draft."

## What it can never do

- Approve, publish, schedule or cancel anything.
- Send e-mail or messages.
- Change someone else's draft, grant roles or create tokens.

Only a person does these, in the panel. Nothing Claude prepares goes live on the site until a person approves it.

## Disconnecting

1. In claude.ai, remove the connector.
2. In the panel, open the **Agent tokens** page. Under **Connected apps**, press **Disconnect**.

Tools that run in a terminal can use a personal token instead. You create it on the **Agent tokens** page, under **New token**. Its value is shown only once. Never paste it into a chat, a document or a message to someone else. If in doubt, press **Revoke**.
