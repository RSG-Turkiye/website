# Accounts and access

Which outside services the site depends on, who owns each, and what to do at a
handover. It records account kinds and secret names only: never addresses,
names or values (the repository is public). Every service is on an
organisation account, none on a personal one. Anything not confirmed in the
repository is marked "confirm in the handover session".

For the person: start at the Turkish page, [README.md](README.md). Secrets are
set with `npx wrangler pages secret put <NAME> --project-name website` by the
person, in their own terminal (CLAUDE.md, rule 7). Pages reads secrets only at
deploy time, so redeploy after changing one ([Deployment](../../README.md#deployment)).

| Service | What it is for | Owning account (kind) | Who holds access after handover (role) | Where its secrets and config live | Handover action |
| --- | --- | --- | --- | --- | --- |
| Cloudflare | Pages projects `website` and `symposium-website`, D1 database `rsg-members`, R2 buckets `rsg-blog-images` and `rsg-mail-attachments`, Workers `rsg-mail-cron` and `rsg-symposium-cron`, Web Analytics | The organisation's Cloudflare account | The website lead plus one other management-team member; confirm in the handover session | Pages secrets (names below); `wrangler.toml` and `workers/*/wrangler.toml` vars; the deploy hook inside the symposium Pages project | Add the incoming people to the account; confirm two people can sign in; confirm in the handover session how access is shared |
| GitHub | The public repository `RSG-Turkiye/website`, Actions CI, branch protection on `main` | The organisation's GitHub organisation | Organisation owners, plus the website lead as maintainer; confirm in the handover session | Repository settings; Actions secret `MAIL_SYNC_SECRET` | Add the incoming maintainers; change `GITHUB_NOTIFY_USERNAME` in `wrangler.toml` to whoever merges the symposium archive PR (it must not be the `rsgturkey` account) |
| GitHub, `rsgturkey` account | Its token opens the CMS and archive pull requests | The organisation's `rsgturkey` GitHub account | The website lead and one other holder; confirm in the handover session | Pages secret `GITHUB_PAT` (scoped to this repository only) | Confirm who can sign in to the account; rotate the token if the holders change |
| Google account (the organisation's) | The Gmail connection that sends and reads mail, the Google Cloud OAuth project (sign-in and Gmail), Drive, Forms and Sheets | The organisation's Google account | Admins who run mail, plus the website lead | Pages secrets `GOOGLE_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (fallback), `TOKEN_ENC_KEY`; vars `GOOGLE_CLIENT_ID`, `RSG_MAIL_FROM` | After any password change, Connections, Gmail, Reconnect; keep the `TOKEN_ENC_KEY` value in the organisation's password manager; confirm in the handover session who may open the Google Cloud project |
| Buffer | LinkedIn and X posts, and Instagram when connected through it | The organisation's Google account | The social media publisher and the website lead | Pages secret `BUFFER_API_KEY`; var `BUFFER_KEY_EXPIRES` in `wrangler.toml` | Renew the API key before its date; see [Buffer](../../README.md#buffer-linkedin-and-x) |
| Instagram | Posts and messages as the organisation | The organisation's Instagram account (admin rights with the organisation's accounts) | The social media publisher | Pages secrets `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`; the Meta app; tokens live in D1 | An admin reconnects it in Connections (the publisher may hold the Instagram login); the token lasts 60 days and is refreshed daily |
| LinkedIn | Posts as the organisation's Page | The organisation's LinkedIn Page (admin rights with the organisation's accounts) | Page Super admins among the incoming team | Pages secrets `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`; var `LINKEDIN_ORGANIZATION` | An admin reconnects it in Connections, signing in as one of the incoming Page Super admins |
| X | Posts as the organisation's account | The organisation's X account (admin rights with the organisation's accounts) | The social media publisher | Pages secrets `X_CLIENT_ID`, `X_CLIENT_SECRET` | An admin reconnects it in Connections if the password changed (the publisher may hold the X login); confirm in the handover session who holds the payment card or credits |
| Cloudflare cron and deploy secrets | The cron Workers and the symposium rebuild | The organisation's Cloudflare account | The website lead | Pages secrets `MAIL_SYNC_SECRET`, `SYMPOSIUM_ARCHIVE_SECRET`, `SYMPOSIUM_DEPLOY_HOOK`, `CF_ANALYTICS_TOKEN`; Worker secrets: `rsg-mail-cron` holds `MAIL_SYNC_SECRET`; `rsg-symposium-cron` holds `SYMPOSIUM_ARCHIVE_SECRET`, `SYMPOSIUM_DEPLOY_HOOK` and `WEBSITE_DEPLOY_HOOK` | None unless someone leaves who knew them; then rotate |
| DreamHost (DNS) | The domain records for the main and symposium sites | The ISCB Student Council | The ISCB Student Council changes records on request | DNS records at DreamHost | The website lead asks the Student Council for any change; confirm in the handover session who the contact is |
| ISCB | The Regional Student Group's yearly renewal with ISCB | The organisation | The management team | Not in this repository | Confirm in the handover session who files the renewal and when |

## Yearly items

- Social tokens and the Buffer key: [Yearly upkeep](../../README.md#yearly-upkeep).
- ISCB renewal: confirm in the handover session who owns it and the date.
- Export the Log (JSON) from the Log pane; the panel keeps only a year.
- Roles, at least two admins, `GITHUB_NOTIFY_USERNAME`, the Gmail reconnect and
  the committees page: [Yearly handover](../../README.md#yearly-handover).

The crash drill and the handover-session checklist are in [drill.md](drill.md).
