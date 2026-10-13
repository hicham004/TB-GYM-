# Going live

**Cost at launch: about $10 a month, plus about $12 a year for the domain.** The server is almost
all of it; everything else starts on a free tier. Prices as listed in September 2026; confirm them
when you sign up.

| What | Where | Monthly |
| --- | --- | --- |
| Server, 8 GB memory, Ubuntu 24.04, EU | Hetzner Cloud CX33 (fallback: Vultr) | ~€7 with its IPv4 (Vultr $40) |
| Domain, DNS, support@ forwarding, photo and backup storage | Cloudflare | ~$1 (domain), rest free to 10 GB |
| Email sending | Resend | free to 100 a day, then $20 |
| Backup "missed night" alert (optional) | healthchecks.io | free |

Both Hetzner and Cloudflare need a card that works internationally. Hetzner sometimes asks for ID
or refuses a card. **If Hetzner sign-up or payment fails, use Vultr** (Frankfurt, Regular Cloud
Compute, 4 vCPU / 8 GB, about $40, also accepts PayPal). Nothing in the setup depends on the provider.
Without progress photos a 4 GB server is enough (about half the price; see `.env.production.example`).

## 1. Sign up, in this order

1. **Password manager** (Bitwarden is free). Every secret below goes in it.
2. **Cloudflare**: create an account, buy the domain (Domain Registration). DNS then lives there.
3. **Server**: on your computer run `ssh-keygen -t ed25519` and give Hetzner the `.pub` file. Create
   an Ubuntu 24.04 server with 8 GB in Germany or Finland, and a firewall that allows only TCP 22, 80
   and 443. In Cloudflare DNS add an `A` record for `app` pointing at the server's IPv4, with the
   cloud icon grey ("DNS only").
4. **Cloudflare R2** (it asks for a card even on the free tier): create two buckets with
   jurisdiction **EU**: `tbgym-media` and `tbgym-backups`. Create two API tokens, each with
   **Object Read & Write** on **one** bucket. On `tbgym-media` add one lifecycle rule: abort incomplete
   multipart uploads after 1 day, and nothing else, ever.
5. **Support inbox**: Cloudflare Email Routing, `support@yourdomain` forwards to your Gmail.
6. **Resend**: add the domain `mail.yourdomain` and copy the DNS records it shows into Cloudflare.
   Also add a TXT record `_dmarc.mail` = `v=DMARC1; p=none; rua=mailto:support@yourdomain`. Wait
   until it says Verified. Create an API key (Sending access). Under Webhooks add
   `https://app.yourdomain/api/notifications/email/provider-events` for all email events and copy the
   signing secret (`whsec_…`).
7. **Backup key, on your computer** (never on the server): `winget install FiloSottile.age`, then
   `age-keygen -o tbgym-backup-key.txt`. **Keep this file in two places: your password manager and a
   printed or USB copy at home. Lose both and every backup is unreadable.** The `age1…` public key
   inside it goes in `.env`.
8. Optional: a healthchecks.io check with period 1 day, grace 2 hours. Copy its ping URL.

## 2. Deploy

1. **Start it** (fill every value in `.env`, then copy the finished file to the password manager):

   ```sh
   ssh root@SERVER_IP
   curl -fsSL https://get.docker.com | sh
   ssh-keygen -t ed25519   # add ~/.ssh/id_ed25519.pub on GitHub: repo > Settings > Deploy keys, read-only
   git clone git@github.com:hicham004/tb-gym-.git /opt/tbgym && cd /opt/tbgym
   cp .env.production.example .env && chmod 600 .env && nano .env
   echo "alias tb='docker compose -f /opt/tbgym/compose.production.yaml'" >> ~/.bashrc && . ~/.bashrc
   tb up -d --build        # about 15 minutes the first time; photo scanning is ready ~5 minutes later
   tb ps                   # every service "healthy", and "migrate" exited 0
   ```

2. **Email**: `tb exec api dotnet TB.Gym.Api.dll send-test-email you@gmail.com` should say `Sent.`
   Reply to it and check that the reply reaches the support inbox. Then register your own account at
   `https://app.yourdomain` and confirm it from the email.
3. **Admin**: `tb exec api dotnet TB.Gym.Api.dll platform-admin grant you@example.com`.
4. **Before inviting anyone**: `curl -sI https://app.yourdomain` shows `strict-transport-security` and
   `content-security-policy`. As a test client, upload a progress photo and see it again.
5. **Backup and restore drill**: run `tb exec backup backup.sh` (it ends with `done`) and check the
   file in the `tbgym-backups` bucket. Paste your key from the password manager into
   `nano /root/key.txt`, then run
   `tb run --rm -v /root/key.txt:/key.txt:ro backup restore.sh latest tbgym_drill /key.txt`.
   The row counts it prints should match your data. Then
   `tb exec postgres dropdb -U tbgym tbgym_drill && shred -u /root/key.txt`. Repeat monthly.

## 3. Afterwards

Optional AI meal suggestions: set `TB_GYM_AI_ENABLED=true` and `TB_GYM_ANTHROPIC_API_KEY` in the
server's secret `.env`; keep the key out of git, browser code and logs. The API maps these to
`Nutrition__Anthropic__Enabled` and `Nutrition__Anthropic__ApiKey`. Direct deployments can use those
environment variables or the `Nutrition:Anthropic` configuration section. Defaults are
`claude-sonnet-5-5`, 2,048 output tokens, a 45-second timeout and five-minute prompt caching when
eligible. TB Gym pays for every suggestion, so also set its ceiling per workspace,
`TB_GYM_AI_MAX_MONTHLY_REQUESTS` and `TB_GYM_AI_MAX_MONTHLY_COST_USD` (for example 100 and 3; 0 keeps
AI off). Restart the API; then a workspace owner sets an allowance up to that ceiling in Settings,
Nutrition, and tests one suggestion through coach review. Leaving AI disabled displays a setup message.

Talk to us, and analytics (UI plan R6.2g). A gym that writes from the homepage is emailed to
`TB_GYM_CONTACT_EMAIL`, or to the support inbox (`TB_GYM_EMAIL_REPLY_TO`) while that is empty; the
request is also kept in the database, so nothing is lost if an email bounces. Give
`TB_GYM_WHATSAPP_NUMBER` in international form (`+961…`) to show a WhatsApp link beside the form.
For visitor counts without cookies or a banner, open a Plausible account (plausible.io, paid after a
trial), add the site under its domain, and copy the file name of the site's script from Site
settings > Site installation (it looks like `pa-AbC123.js`) into `TB_GYM_ANALYTICS_SCRIPT`; the
script and its events pass through this domain, so nothing third-party loads. Restart the API and the
web container after changing any of the three. Write the privacy note yourself; the code holds none.

- **Update**: `cd /opt/tbgym && tb exec backup backup.sh && git pull && tb up -d --build`.
- **Server lost**: new server, point the DNS record at it, and repeat Deploy step 1 **up to
  `nano .env`** (paste `.env` from the password manager). Then start only the database,
  `tb up -d postgres`, put the key in `/root/key.txt` and restore into the empty database:
  `tb run --rm -v /root/key.txt:/key.txt:ro backup restore.sh latest tbgym /key.txt`. Finish with
  `tb up -d --build` and `shred -u /root/key.txt`. Everyone signs in again; at most a day of data is
  lost.
- **Logs**: `tb logs --tail 200 api` (or `worker`, `backup`). `docs/LAUNCH-CHECKLIST.md` Part 1 is
  the full list to tick.
