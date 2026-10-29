# CLAUDE.md

## mattpocock-skills

When a `mattpocock-skills:*` skill (e.g. `grilling`, `domain-modeling`, `wizard`, `codebase-design`, `prototype`) needs to ask the user a question, use the `AskUserQuestion` tool instead of asking in plain text.

- One `AskUserQuestion` call can hold 1-4 questions; batch related ones.
- Give 2-4 concrete options per question; put the recommended option first with "(Recommended)" in the label.
- Use plain text only for truly open-ended questions with no sensible options.
