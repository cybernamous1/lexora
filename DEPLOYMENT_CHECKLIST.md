# Deployment checklist

- [ ] Create a D1 database named `lexora-knowledge`.
- [ ] Put the real database ID in `wrangler.jsonc`.
- [ ] Install dependencies with `npm install`.
- [ ] Run `npm run build` and fix any build errors.
- [ ] Apply D1 migrations remotely (`0001_initial.sql` and `0002_knowledge_shards.sql`).
- [ ] Run `npm test` and confirm it passes.
- [ ] Deploy with `npx wrangler deploy`.
- [ ] Open the deployed URL and test on mobile.
- [ ] Test TXT import, DOCX import, transform, copy, TXT export, DOCX export.
- [ ] Confirm `/api/health` returns `textRetention: false`.
- [ ] Confirm `/api/knowledge` returns one shard (`wordiness-extra`) and no `degraded` flag.
- [ ] If strictly personal, protect the Worker with Cloudflare Access.
- [ ] Do not add any code that sends editor text or uploaded files to the Worker.
