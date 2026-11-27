# Auto-ok provenance

This contract is shared by Claude and Codex, for both filing and later judgement. `kickoff` stops
the current invocation after planning; that alone never prohibits another run from implementing
an otherwise eligible issue. Keep the existing label, repository and human-judgement exclusions.

Before using `--no-auto-ok` when none of those exclusions holds, verify the user's actual prohibition
against its original prompt or comment and record it in the issue body:

```markdown
## 自動実行の制約

- 出所: user
- 参照: <original user prompt reference or comment URL>
- 指示: <verbatim instruction prohibiting automatic execution>
```

`issue:file` refuses an unsupported opt-out; a recorded user prohibition is preserved by the shared
decision and also refuses a later `--apply`. The field shape is checked mechanically; the filer must
verify that the quote exists at the reference and actually prohibits automatic execution. A request
to plan only is not such a prohibition. Do not invent a quotation or attribute an agent's inference
to the user.

For later judgement, read the body and all comments. `[trusted]` means write access, not human
authorship; `[automated]` identifies the existing bot/run-marker classification. An `Auto-decided`
plan and an earlier `auto-ok: not applied` are agent decisions, never original user instructions.
Verify any prohibition against its original user source; record that source and quotation in the
decline reason. Preserve a real user prohibition, including a later human comment, even without the
structured body section. If none exists, no existing exclusion holds and the body does not declare
`- 人の判断: 要`, apply `auto-ok` despite an earlier inferred opt-out. A new judgement records this
reading rather than inheriting the old decline as authority. An unreadable source is not permission
to apply: report it for clarification.

An issue a `run:handoff` `fullrun` / `halfrun` / `prrun new` child files carries
`handoff:implementing`, an excluded label: that run implements it, so neither the filing nor a later
judgement opts it in. Only the hand-off marks in the environment decide it; a `fullrun new` typed
into a session directly leaves no mark and is judged as before.

When that child's `run:handoff` into the issue's lane refuses or fails, the child ends: the label is lifted and the filing's `auto-ok`
decided again without it, so `backlogrun` can take it (`run-handoff-release.ts`).

A body declaring `- 人の判断: 要` is never a candidate, and `--apply` refuses it, writing nothing —
the same reading `issue:file` withholds `auto-ok` by. `backlog:triage --adopt` settles a park; it
does not opt the issue in.

To move such an issue, record the judgement, then rewrite the declaration to `- 人の判断: 不要`; the
changed body is read again at the next judgement.
