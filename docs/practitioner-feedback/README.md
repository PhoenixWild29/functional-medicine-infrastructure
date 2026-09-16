# Practitioner feedback — primary sources

The unedited sources behind the work orders. Read-only: nothing in this folder is
rewritten, summarised in place, or "cleaned up." A work order quotes these; it never
replaces them.

| File | What it is |
|---|---|
| [2026-09-11-gina-rooks-email.md](2026-09-11-gina-rooks-email.md) | Gina Rooks, "Preliminary notes", 2026-09-11 — the email behind Phase 21 |
| [2026-09-11-product-run-thru-transcript.md](2026-09-11-product-run-thru-transcript.md) | "Compound IQ: Product Run Thru", 2026-09-11 — Gemini notes and full transcript |

## Why this folder exists

Until now every copy on disk was a paraphrase, and a work order drifted from its
source without anyone being able to see it: WO-105 specified a `scheduled` order
state, a `release_at` release cron and a `protocol_instance_id` + `cycle_number`
linkage, none of which appear in either source, while the email it cited says
nothing about titration at all. The sources lived only in a mailbox and a Google
Doc, so the drift was invisible to code review.

**Check every new or amended work order against these files before building.** When
a work order states a requirement, it should be able to quote the sentence it came
from — as WO-101, WO-102, WO-104 and now WO-105 do. A requirement that cannot be
quoted is a proposal, and should say so.
