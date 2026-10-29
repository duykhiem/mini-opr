# CLAUDE.md

Mini OPR: demo of one patient record travelling across ambulance transfers on several devices, synced through one Coordinator. Status: spec and ADRs, no code yet.

## Conventions

- Tickets, docs and code comments in English. Never use the em dash.
- README stays non-technical; technical decisions go in `docs/adr/`.
- Use glossary terms exactly; respect "_Avoid_" synonyms.

## Domain

@CONTEXT.md

Before working in an area, read the ADRs in `docs/adr/` that touch it. Flag any conflict with an ADR instead of silently overriding it. See `docs/agents/domain.md`.

## mattpocock-skills

When a `mattpocock-skills:*` skill (e.g. `grilling`, `domain-modeling`, `wizard`, `codebase-design`, `prototype`) needs to ask the user a question, use the `AskUserQuestion` tool instead of asking in plain text.

- One `AskUserQuestion` call can hold 1-4 questions; batch related ones.
- Give 2-4 concrete options per question; put the recommended option first with "(Recommended)" in the label.
- Use plain text only for truly open-ended questions with no sensible options.

## Agent skills

### Issue tracker

GitHub Issues on `duykhiem/mini-opr`, through the `gh` CLI; the wayfinder map is "Mini OPR online: spec". See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: the glossary is `CONTEXT.md` and ADRs go in `docs/adr/`, both at the repo root. See `docs/agents/domain.md`.
