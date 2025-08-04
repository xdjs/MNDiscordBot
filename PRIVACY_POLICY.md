# Privacy Policy

_Last updated: 2025-08-04_

Your privacy is important to us.  This Privacy Policy explains what data **MNDiscordBot** ("the Bot", "we", "us", or "our") collects, how we use it, and your rights.

By using the Bot you agree to the practices described below.  If you do not agree, please remove the Bot from your Discord server and/or discontinue its use.

## 1. Data We Collect

| Category | Examples | Purpose |
|----------|----------|---------|
| Discord identifiers | User ID, Username, Discriminator, Guild ID, Channel ID | Required for core functionality & message delivery |
| Spotify information (optional) | Access token, refresh token, top track, top artist, listening activity | To provide listening summaries and other music-related features |
| Commands & Messages | Slash-command interactions, message content you expressly send to the Bot (e.g. `/chat Question?`) | To generate requested responses |
| Usage metadata | Timestamps, error logs | To monitor uptime and debug issues |

We **do not** store your email address, payment information, or private Discord messages that are not explicitly sent to the Bot.

## 2. How We Use Your Data

1. To provide the Bot’s features (daily wrap-ups, chat replies, artist facts, etc.).
2. To maintain and improve the Service and fix errors.
3. To comply with legal obligations or law-enforcement requests when required.

## 3. Legal Bases (GDPR)
We rely on the following legal bases:
* **Consent** – You grant the Bot access when you invite it or authenticate with Spotify.
* **Legitimate Interests** – We process minimal data necessary to operate and secure the Service.

## 4. Data Sharing & Disclosure
We do **not** sell or rent your data.  We may share it only:
* With **service providers** that host or process data on our behalf (e.g. Supabase, Vercel).  They are bound by confidentiality and suitable security measures.
* If required by law or valid legal request.

## 5. Data Retention
* **Listening data** (top track / artist) is automatically cleared each day after the daily wrap-up is generated.
* **Snapshots** stored in the `wrap_up` column are retained for up to 24 hours to enable pagination, then deleted.
* **Spotify tokens** are retained until you run `/disconnect` or 90 days of inactivity, whichever comes first.
* Logs are stored for a maximum of 30 days.

## 6. Your Rights
Depending on your jurisdiction you may have rights to:
* Access the data we hold on you.
* Request correction or deletion.
* Withdraw consent.

You can exercise these rights by:
1. Running `/disconnect` in any Guild to delete your stored Spotify data and listening history.
2. Removing the Bot from your Guild.
3. Contacting us at **<avery.kwok05@yahoo.com>**.

We will respond within 30 days.

## 7. Security
We use industry-standard encryption (HTTPS/TLS) in transit and secure storage via Supabase with role-based access control.  However, no method of transmission or storage is 100 % secure; you use the Service at your own risk.

## 8. Children’s Privacy
The Bot is not directed to children under 13.  If you believe we have collected personal data from a child, contact us immediately and we will delete it.

## 9. International Transfers
Data may be processed and stored on servers located outside your country.  We take reasonable steps to ensure your data receives an adequate level of protection.

## 10. Changes to This Policy
We may update this Policy periodically.  Material changes will be announced in the Bot’s support server or via an in-bot notice.  Continued use of the Bot after changes constitutes acceptance.

## 11. Contact Us
If you have questions about this Privacy Policy, reach us at **<avery.kwok05@yahoo.com>**.

---
*Thank you for trusting MNDiscordBot!*