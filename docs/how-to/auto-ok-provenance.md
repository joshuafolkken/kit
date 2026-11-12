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
structured body section. If none exists and no existing exclusion holds, apply `auto-ok` despite
an earlier inferred opt-out. A new judgement records this reading rather than inheriting the old
decline as authority. An unreadable source is not permission to apply: report it for clarification.
