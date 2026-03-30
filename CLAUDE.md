# CompoundIQ — Claude Code Instructions

## PHASE WORKFLOW REMINDER

**At the start of every phase and every conversation involving phase work, read this file:**

`C:\Users\ssham\.claude\projects\c--Users-ssham-OneDrive-Functional-Medicine\memory\feedback_phase_build_workflow.md`

This file contains the complete 10-step workflow that MUST be followed for every phase. Do not begin any phase work without reading it first.

### Quick Reference (full details in the memory file above)

1. Build WO → set `in_progress`
2. Run first review agent
3. Fix ALL blocking + non-blocking issues
4. Repeat 1–3 for every WO in the phase
5. Set all WOs to `in_review` once all are built + reviewed + fixed
6. Hand user one cowork prompt for the entire phase
7. User gives prompt to cowork — **wait, do nothing**
8. User returns cowork review to me
9. Fix all cowork findings
10. Cowork passes phase → mark all WOs `completed`

**`completed` status is ONLY set at step 10. Never before.**

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->
