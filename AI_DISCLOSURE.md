# AI-assisted work disclosure

BiyaHey! is built with AI assistance, and we say so. This document explains what
that means for contributors, reviewers and users of the data.

## Why this exists

AI coding agents can write code, tests, docs and plans quickly, but they can
also invent a fare, a coordinate, a licence claim or a "passing" test result.
Transit data is used by real commuters; a plausible-but-wrong number is worse
than a missing feature. Disclosure plus human verification is how we keep speed
from turning into quiet fabrication.

## Project-level disclosure

Plan 1 (the data spine, router and BFF on `feature/data-spine`, 2026-11-01) was
implemented with heavy AI assistance: task briefs and plans, code, tests,
research probes and review passes were produced with AI agents under human
direction, then reviewed task-by-task by a separate reviewer agent and a
controller. Every release note or PR that includes AI-assisted work must say so;
the reviewed artifacts and the acceptance evidence live in the runbooks.

This file does **not** grant permission to ship unverified data. It records how
the project actually works.

## What contributors must disclose

In the PR template's **AI-assisted work** section, state:

1. **Tool(s) and model(s)** used (for example: an AI coding agent, a chat
   assistant, a completion tool).
2. **Scope** — which files or behaviours were generated or substantially
   modified with AI help (code, tests, docs, data transcription, analysis).
3. **Human verification** — the commands you ran and the evidence you checked
   (test output, live API probe, artefact inspection). "The model said it
   passes" is not verification.
4. **Anything not AI-assisted**, when that distinction matters to a reviewer.

Small autocomplete-style edits still count as AI-assisted if they change
behaviour or data; a one-line typo fix does not need a disclosure essay.

## Non-negotiable rules

- **No invented data.** Fares, effectivity dates, coordinates, stop names,
  licences and coverage numbers must be traceable to a registered source or
  explicitly marked provisional (`needs_verification: true`) and recorded as a
  known gap.
- **No invented test results.** Paste or summarise real command output; do not
  claim a suite ran when it did not. If something is skipped or unavailable on
  your machine, say so.
- **No unlicensed data.** If a reuse grant cannot be stated, the dataset does
  not enter the repository or the feed. See `data/provenance/`.
- **No silent contract changes.** API/DTO changes need tests and a note in the
  PR; Plan 2 consumes these types from `@biyahey/shared`.
- **Review is human-owned.** An AI reviewer may assist, but a human maintainer
  approves the merge and is accountable for it.

## How reviewers should use this

Ask for the verification evidence behind any claim that is expensive to check
(fares, coverage, route ids, licence text, live counts). Treat AI-generated
prose as untrusted until it matches an artifact, a test or a command output.
The project's own review history deliberately retracts overclaims when they are
found; that is the expected standard, not an embarrassment.

## Attribution and licensing of AI output

AI-assisted contributions are accepted under the repository's licences (MIT for
code, CC BY 4.0 for docs) and the data licences described in
`data/LICENSE-DATA.md`. Contributors confirm they have the right to submit the
work, including any third-party code or text an AI tool reproduced.
