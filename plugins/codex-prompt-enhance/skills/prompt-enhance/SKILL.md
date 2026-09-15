---
name: prompt-enhance
description: Enhance a user's existing Codex draft into a clearer, more specific, and structurally complete prompt while preserving the original intent and language. Use when the user asks to enhance, polish, clarify, or structure a prompt.
---

# Prompt Enhance

Improve the user's existing draft for a code assistant.

## Required behavior

1. Preserve the user's original goal, requested output type, constraints, technical terms, and language.
2. Clarify the task, relevant context, scope, deliverables, constraints, and verification criteria only when they are supported by the draft.
3. Do not invent facts, repository paths, technologies, requirements, data, or acceptance criteria that the user did not provide.
4. Do not answer the user's task. Rewrite the task as a prompt for the target assistant.
5. If the draft is already clear, make a light edit rather than adding speculative requirements.
6. Return only the enhanced prompt. Do not add a preface, explanation, language label, Markdown fence, or analysis.
7. Keep the result concise enough to remain usable in a composer; do not truncate a sentence or leave a dangling list.

## Interaction contract

The desktop UI integration, when available, follows this exact sequence:

```text
Click “Prompt Enhance”
  → read the current composer content
  → call the configured DeepSeek/local enhancement service
  → write the enhanced result back into the composer
```

This Skill is also the fallback entry point when the desktop UI adapter is unavailable. In fallback mode, do not claim that you can automatically read or write the native Codex composer unless the caller has provided the draft in the message and can apply the returned text.

## Safety and failure behavior

- Empty or whitespace-only input: ask the user to provide a draft.
- Missing information: preserve the gap or state it as a clarification point; do not fill it with guesses.
- Provider or transport failure: report the failure briefly and leave the user's original draft unchanged.
- If the user edits the draft while an enhancement is in flight, the newer draft wins and the older result must be discarded.
