# Full-Stack Migration Plan: Render/Vercel → Fly.io

> Goal: Deploy **both** backend and frontend on Fly.io, consolidating everything under a single hosting provider.

---

## 🛠️ Quick Start (Beginner-Friendly)
1. **Install Fly CLI.** `brew install flyctl` (macOS) or visit https://fly.io/docs/hands-on/install/.
2. **Login.** `flyctl auth login` and open the browser link.
3. **Launch app.** From the repo root: `flyctl launch` → accept prompts:
   - App name (leave default or pick your own)
   - Region (pick the closest, e.g., `iad`)
   - `Dockerfile` detected → **yes**
   - Swap 8080 port if prompted (make sure your server listens on `process.env.PORT` or 8080).
4. **Set secrets.** `flyctl secrets set DISCORD_BOT_TOKEN=... CHAT_HOOK_URL=...` (paste all keys from Render).
5. **Deploy.** `flyctl deploy` — wait for build → deploy → health checks.
6. **Test.** Visit `https://<app>.fly.dev/health` (or your API route) to confirm it works.
7. **Custom domain (optional).** Set `A` and `AAAA` records per Fly docs or use `flyctl certs add api.example.com`.
8. **Update frontend env vars.** In your frontend project set `NEXT_PUBLIC_API_BASE=https://api.example.com` (or the default `*.fly.dev` domain) so it calls the new backend.
9. **Deploy the frontend.** In the frontend repo run `flyctl launch` (choose a unique app name like `myapp-web`), then `flyctl deploy`. If the app is static, Fly will serve it directly; if it’s Next.js, be sure the Dockerfile or buildpacks build the production output.

Once this works, follow the detailed checklist for scaling, volumes, and CI/CD.

---

## 🧩 Collapsing Hook Services into One Fly App
Fly lets a single app run multiple **process groups** (e.g., `web`, `worker-image`, `worker-profile`). We’ll move the code that used to live in Render hook services into this repository and run it inside the same Fly deployment.

### 1. Repo changes
1. Create a `workers/` folder and copy—or rewrite—the logic from each hook service (`image-hook`, `profile-hook`, `listen-hook`, etc.) as standalone scripts (e.g., `image.ts`, `profile.ts`).
2. Build each worker with the regular TypeScript build (`tsc -p tsconfig.json`), outputting to `dist/workers/`.
3. Remove the external fetch calls:
   ```ts
   // before (Render)
   await fetch(process.env.IMAGE_HOOK_URL!, { method: 'POST', body: JSON.stringify(payload) });

   // after (in one app)
   import { enqueueImageJob } from '../workers/queue';
   enqueueImageJob(payload); // push to BullMQ / Supabase queue / Rabbit / etc.
   ```
4. Delete the now-unused `*_HOOK_URL` and `*_HOOK_SECRET` env vars.

### 2. Queue or direct worker pattern
- **Simple**: Use an in-memory queue like [p-queue](https://github.com/sindresorhus/p-queue) inside the Node process. Suitable for low traffic but restarts drop jobs.
- **Better**: Use Redis (Fly has free 256 MB redis via Upstash or you can deploy your own) + BullMQ/Graphile Worker.

#### 📝 How to add Redis on Fly (optional)
1. **Provision**: `flyctl redis create --name mn-redis --region iad --memory 256` – this spins up a managed Upstash Redis database.
2. **Copy the URL**: After creation, Fly prints `REDIS_URL`. Save this value.
3. **Store secret**: `flyctl secrets set REDIS_URL=<the-url>` – this makes it available to both the web and worker processes.
4. **Install a queue lib**: e.g. `npm i bullmq ioredis`.
5. **Update workers/queue.ts**: replace the in-memory `PQueue` with BullMQ queues using the shared `REDIS_URL`.
6. **Scale**: You can now run multiple Fly machines per worker group with `flyctl scale count 3 --process worker-image` and the Redis-backed queue will distribute jobs.
7. **Metrics**: Upstash provides a dashboard; you can also add BullMQ’s UI if desired.

### 3. Define process groups in `fly.toml`
```toml
[processes]
web = "node dist/index.js"          # existing HTTP API
worker-image = "node dist/workers/image.js"
worker-profile = "node dist/workers/profile.js"
worker-listen = "node dist/workers/listen.js"
```
Fly will scale each group independently: `flyctl scale count 3 --process worker-image`.

### 4. Secrets & env
`flyctl secrets set DISCORD_BOT_TOKEN=…` (remove all `*_HOOK_URL` vars). If you use Redis, set `REDIS_URL` for both `web` and worker groups.

### 5. CI/CD adjustments
Fly deploys all process groups together, no extra work. GitHub Actions step remains the same.

### 6. Cut-over
1. Deploy staging app (`staging.fly.dev`).
2. Ensure workers pick up jobs & logs show processing.
3. Run chat/image/listen commands in Discord → confirm results.
4. Switch DNS to production app.

---

## 1. Fly.io Project Setup
- [ ] Install Fly CLI: `brew install flyctl` or download binary.
- [ ] `flyctl auth signup` (or `login`).
- [ ] In repo root, run `flyctl launch` to create the app and `fly.toml`.
- [ ] Confirm `fly.toml` exposes the correct **internal_port** (usually 8080) and health checks.

## 2. Dockerfile / Builder
- [ ] If you already have a Dockerfile (Node 20-alpine), Fly will use it.
- [ ] If not, Fly can auto-build via **Heroku buildpacks**; Dockerfile is recommended for consistency.
- [ ] Ensure your server listens on `process.env.PORT` (Fly passes the chosen port via env var).

## 3. Environment Variables & Secrets
- [ ] Export secrets from Render.
- [ ] `flyctl secrets set KEY=value ...` to store them (they’re encrypted and injected at runtime).
- [ ] **Update service endpoint variables** (`CHAT_HOOK_URL`, etc.) to Fly domain `https://<app>.fly.dev/...` or your custom domain.

## 4. Volumes & Persistent Storage (if needed)
- [ ] Create a volume: `flyctl volumes create data --size 1 --region iad`.
- [ ] Mount it in `fly.toml` under `mounts` (e.g., source=`data`, destination=`/data`).

## 5. Scaling & Regions
- [ ] Scale VM size: `flyctl scale vm shared-cpu-1x --memory 256`.
- [ ] Add instances near users: `flyctl regions add lhr fra sin`.
- [ ] Configure autoscaling: `flyctl autoscale set min=1 max=3 balance=connected`.

## 6. Networking & Domains
- [ ] Default Fly domain: `<app>.fly.dev` with free HTTPS.
- [ ] For custom domain:
  1. `flyctl certs add api.example.com`.
  2. Add DNS `A` + `AAAA` records Fly outputs.
  3. Wait for certificate to validate.
- [ ] Update env vars (`CHAT_HOOK_URL`, etc.) with the new hostname.

## 7. CI/CD Pipeline
- [ ] Add GitHub Actions workflow:
  ```yaml
  name: Deploy to Fly
  on:
    push:
      branches: [main]
  jobs:
    deploy:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v3
        - uses: superfly/flyctl-actions@v1
          with:
            args: deploy --remote-only
          env:
            FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
  ```
- [ ] Generate a Fly API token (`flyctl auth token`) and add it to GitHub repo secrets.

## 8. Background Workers / Cron Jobs
- [ ] For each worker, create an additional Fly app or use Fly **process groups** in `fly.toml`.
- [ ] Schedule periodic jobs with **fly cron** or GitHub Actions if necessary.

## 9. Monitoring & Logging
- [ ] Stream logs: `flyctl logs -a <app>`.
- [ ] Metrics: view in Fly dashboard (CPU, Memory, Responses).
- [ ] Set up alerts via Fly’s **Status Checks** or third-party Pingdom/Uptime.

## 10. Cut-over Checklist
1. [ ] Deploy backend to Fly in staging (`staging.fly.dev`).
2. [ ] Smoke test endpoints & hooks from the Fly-hosted frontend; ensure CORS and auth work.
3. [ ] Point custom domain (`api.example.com`) to Fly (DNS + cert).
4. [ ] Update `CHAT_HOOK_URL` et al. via `flyctl secrets set`.
5. [ ] Redeploy (`flyctl deploy`) so new secrets are live.
6. [ ] Monitor logs and metrics; roll back with `flyctl releases rollback` if needed.

---

After completing every step, **your entire stack—backend *and* frontend—will be running on Fly.io** with global edge regions. 