# Carvana Onboarding Recovery Layer

A working web prototype that fixes Carvana's broken sell-side plate / VIN lookup and buy-side account-creation gate. Built as a Gauntlet AI-product assignment, designed to be PM-shareable to a real Carvana product team.

**Status:** scaffold phase. See `tasks.md` for slice progress.

## Foundational artifacts

Read these in order. They are the single source of truth; downstream docs reference them.

- [`constitution.md`](./constitution.md) — rules, tech stack, non-negotiables
- [`spec.md`](./spec.md) — user stories, acceptance criteria, demo script
- [`plan.md`](./plan.md) — architecture, decisions table, sequencing
- [`tasks.md`](./tasks.md) — sliced backlog, checkbox-tracked
- [`QA_ADVERSARY.md`](./QA_ADVERSARY.md) — how the qa-adversary sub-agent attacks this project

## Research

The pitch frame is evidence-driven. See:

- [`research/walkthrough-findings.md`](./research/walkthrough-findings.md) — live Chrome walkthrough of Carvana's sell + buy onboarding (S1-S6, B0-B8 findings)
- [`research/plate-api-landscape.md`](./research/plate-api-landscape.md) — vendor comparison + recommended cascade
- [`research/carvana-reviews-catalogue.md`](./research/carvana-reviews-catalogue.md) — categorized complaints from Reddit, ConsumerAffairs, BBB, app stores
- [`research/competitor-entry-funnels.md`](./research/competitor-entry-funnels.md) — 10-competitor entry-funnel comparison
- [`research/carvana-business-case.md`](./research/carvana-business-case.md) — $46M / yr conservative ROI math

## Headline number

**$46M / year** conservative net recovered acquisition spend, payback under 2 weeks. See `research/carvana-business-case.md` for the math sheet and sources.

## Headline finding

> Carvana's own promise: "Get a real offer in 2 minutes."
> Carvana's actual behavior: plate lookup fails on a real CA license plate with "we couldn't find that license plate. Please check entry and try again." VIN submission silently resets the form to the wrong tab with no error message.
>
> The fix is not a vendor swap. It is competent integration of vendors Carvana already pays for, plus browser-side OCR no competitor offers, plus one sentence of empathy copy. See `spec.md` user stories US1-US7.

## Repo locations

- GitHub: https://github.com/scott-lydon/carvana-onboarding
- GitLab (Gauntlet evaluation): https://labs.gauntletai.com/scottlydon/carvana-onboarding

Both remotes carry the same commits via the dual-push pattern documented in `~/Documents/Claude/Projects/Gauntlet/CLAUDE.md`.
