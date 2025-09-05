# WhatsApp Bot MVP (Render + WhatsApp Cloud API)

A minimal, production-lean WhatsApp bot you can deploy quickly for personal demos.

## Stack
- WhatsApp **Cloud API (Meta)**
- Node.js + Express webhook
- OpenAI (gpt-4o-mini) for intelligent fallback replies
- Dockerized and ready for **Render**

## Quick Start (Option A: Subdomain)
1. Create a Business app at developers.facebook.com → add **WhatsApp**.
2. Copy **Phone Number ID** and **Temporary Access Token** (later replace with long-lived).
3. Add yourself as a **Tester** and accept invite.
4. Push this repo to GitHub.
5. Deploy to **Render** as a Web Service (Docker). Add env vars from `.env.example`.
6. Add a custom domain on Render: `ai.sivakumar.ai` and update your DNS with a CNAME to the Render hostname.
7. In Meta → WhatsApp → Configuration
   - Webhook URL: `https://ai.sivakumar.ai/webhook`
   - Verify Token: same as `META_VERIFY_TOKEN`
   - Subscribe to `messages`.
8. Send “Hi” from your tester WhatsApp to the Meta test number.

## ENV VARS
See `.env.example`. Set them in Render's dashboard (do not commit real secrets).

## Local Dev (optional)
```bash
cp .env.example .env
npm install
npm run dev
```
Then expose via ngrok if needed for webhook testing.

## Notes
- Replace temporary token with a **long-lived** System User token (Business Manager) for reliability.
- Use Render logs to debug `webhook` or send errors.
- Extend `routeAndReply()` for your intents once MVP works.
