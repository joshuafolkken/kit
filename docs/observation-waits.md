# Resuming an investigation whose observation conditions are unmet

When an investigation finds evidence missing, an investigator with write permission records the
evidence it needs as a checklist in a comment on the same Issue.

```markdown
## Observation evidence

- [ ] multi-slot: a brief and a disposition example for several review slots, not only code
- [ ] same-head: an early review push, gate, Actions and every review attestation on the same HEAD
- [ ] comparison: a comparable control and its disposition result
- [ ] cost: the comparison cost, fetched
```

Add the actual comment URL and the required keys to the Issue body in the form below. Free text in
a comment or a closing message alone does not classify the Issue as waiting on an observation.

```markdown
<!-- josh:observation-wait:v1 https://github.com/OWNER/REPO/issues/7400#issuecomment-123 multi-slot,same-head,comparison,cost -->
```

The body and the comment are the persistent record of the wait condition. Closing releases the lane
through the existing wait path and does not add to the failure count. Selection and the board use
the same condition. The board puts a waiting Issue in the waiting column and shows the missing keys.
In a terminal, that reason text links to the evidence comment (output sent to a pipe, such as
`--chat`, carries no link, like every other link). An Issue queued but not yet launched with `run:add --retry`
that the plan will not reach (because it is waiting) also goes in the waiting column, not the lanes
column. One the plan launches next stays in the lanes column.

When the lane ledger records the examples a condition needs, a ledger condition can be appended to
the declaration. Once it is met, the next selection can re-observe the Issue without waiting for the
evidence comment's checks. Until then it is held as a wait as before and is not counted as a
failure.

```markdown
<!-- josh:observation-wait:v1 https://github.com/OWNER/REPO/issues/7400#issuecomment-123 multi-slot,same-head,comparison,cost ledger:multi-slot-early-push>=1 -->
```

`multi-slot-early-push` is the count of early-push records whose early push succeeded (`pushed`) in
a round with two or more review slots. An early-push record carries its HEAD (`head`) and its review
slot count (`slots`). Older records without `slots` are not counted. An unknown metric name keeps
the wait as an unknown declaration form. A checkout that cannot read the ledger counts 0.

Check only the conditions whose evidence was obtained, and attach a GitHub evidence link on that
line (for example `- [x] cost: comparison cost [evidence](https://github.com/OWNER/REPO/issues/7400#issuecomment-456)`).
When every required key is present once, checked and linked to evidence, the next selection can
re-observe the Issue. This records that the investigator confirmed the evidence; the link alone does
not interpret a measurement automatically.

More merges, an early push of the code slot alone, or a cost not yet fetched do not meet the
conditions above. Do not delete a required condition to resume. A key deleted from or duplicated in
the comment, an unchecked item, a missing evidence link, an unknown declaration form, a fetch
failure, or an author whose write permission cannot be confirmed keeps the wait. A satisfied comment
is fetched again every time, and the body is re-judged after a restart. Ordinary mechanical failures
and waits on a person's judgment are classified as before.
