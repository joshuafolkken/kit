# Why the review policy and rubric are the way they are

The history and justification behind `prompts/review.md` and `prompts/review-rubric.md`, kept off
every review's read path. Each section is cited from the rule it explains.

## The level is decided from the changed paths

`prompts/review.md` → "Review level". "This one is small" is a judgement made under cost pressure,
and cost pressure resolves it toward "small" exactly when a defect is most likely to be shipped. A
rule an agent applies from memory is a rule an agent can talk itself out of; one it has to run
answers the same way every time.

What `pnpm josh review:brief --level-only` computes:

| Every changed path is…                                                                   | Level    | Rounds            |
| ---------------------------------------------------------------------------------------- | -------- | ----------------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1                 |
| anything else                                                                            | `medium` | up to 2 (the cap) |

**One non-inert path decides the whole change.** A review reads the change, not a subset of it, so
there is no per-file level. An empty diff also takes `medium` — answering `low` to "nothing changed"
would hand a reduced level to a caller that failed to read the diff.

**Three things that look inert are not.** `.vscode/**`, `.gitattributes` and `.prettierignore` are all
in `package.json`'s `files` and are written into every consumer project by `josh init` / `josh sync`,
so a defect in one reaches a consumer and is reviewed at `medium` like any other shipped file.

**Documentation is not inert either.** `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` are all
reviewed at `medium`, though exempt from _testing_ — the next section.

## Documentation is reviewed at `medium`

`prompts/review.md` → "Review level"; `prompts/review-rubric.md` → "Severity". The "Non-runtime
updates" exception in `prompts/testing-guide.md` exempts documentation from _testing_ — which asks
whether an automated test could have caught the defect — while the review level asks whether a human
reading the diff is the only thing that can. Measured on joshuafolkken/kit#963 and #965, both
documentation-only by that classification: a `medium` review found ten real defects in each —
pointers into sections that had been removed, and citations naming the wrong file, in artifacts
distributed to every consumer — that nothing else would have caught. A severity rule that ranked
documentation below runtime code would contradict that.

## Why the round cap is two

`prompts/review.md` → "Review round cap". The severity rule is not a stopping condition on its own.
Every fix creates new surface, and a review whose scope is the whole change finds something in it —
so the loop is bounded by how much new code the fixes produce, which is unbounded.

This is measured, not theorized. On joshuafolkken/kit#854 four rounds produced 18 findings; on #855
two rounds produced 19. Almost none of them was a repeat: each round found new things, and many of
those were about code the **previous round's fix** had just written. Two rounds of that is
diligence; a third is the review chasing its own tail.

Whether round 2 runs at all became `pnpm josh review:round2`'s answer in joshuafolkken/kit#1433. Its
two `skip` arms are the states in which round 1's fix code needs no review — the round exists because
that fix code is otherwise unreviewed (joshuafolkken/kit#1222). A merge-conflict resolution review
was taken off the count in joshuafolkken/kit#1623: the cap bounds re-reading the change under review,
and a resolution review reads a different subject.

## The two skip arms

`prompts/review.md` → "When round 2 is skipped entirely, and when it is not". Both `skip` arms are
states in which round 1's fix code needs no review: **A** — the fix delta is empty, round 1's findings
closed without an edit; **B** — every path in the fix delta is inert, neither executing, instructing,
nor shipping. **Neither arm weakens the standard.** A round-1 High/Medium that did not close is not a
closed finding, so `--round-1-closed` is not passable; the cap is still two rounds; and a confirmed High
still blocks the merge. A documentation-only fix delta is not inert, so a prompt fix answers
`required`.

## The rejected wider skip

`prompts/review.md` → "When round 2 is skipped entirely, and when it is not". joshuafolkken/kit#1433
also proposed exempting every fix delta that is not a runtime code path. **It was not adopted**: a
documentation-only diff is exactly where the review is the only detector (the #963 / #965
measurement above), so a prompt fix answers `required`.

## Why branch 3 is the default disposition

`prompts/review.md` → "Three-way disposition after the cap" (joshuafolkken/kit#1469).
**What it costs, and why that is the right trade.** A dropped
finding that later turns out to matter is re-found by the next review of that code, at the price of
one round it would have paid anyway. A filed finding that never mattered is carried forever — placed
in an epic, offered by `epic:next`, read by everyone who scans the backlog. The two errors are not
symmetric, and the old default was on the expensive side of them. "It needs a decision" stopped being
a branch-2 condition on its own for the same reason. Follow-up filing may run in a delegated unit
since joshuafolkken/kit#1892, and an `ask` from `epic:bundle` is decided rather than parked since
joshuafolkken/kit#1339.

## Why the rubric does not re-check lint

`prompts/review-rubric.md` → "4. Project conventions". `pnpm josh gate` precedes the review, and
`pnpm josh format:edited` runs `eslint --fix` and `prettier --write` after every `Edit` / `Write`, so
anything ESLint decides has already failed as an error or been corrected before the reviewer reads the
diff. Re-checking it inflated the first round's finding count. Each item was verified against the
rule that enforces it:

- **Naming** — `@typescript-eslint/naming-convention` (`eslint/rules/naming-convention.js`).
- **`export default`** — `import/no-default-export` is `error` project-wide (`eslint/rules/import.js`),
  switched off only for `*.d.ts` in `eslint/base.js`.
- **Individually named exports of function declarations, and of consts that are not `UPPER_CASE`** —
  `no-restricted-syntax` in `eslint/rules/code-quality.js`. Its selector exempts
  `ArrowFunctionExpression`, so `export const helper = (s: string): string => s` passes it.
- **File names** — kebab-case through `unicorn/filename-case`.
- **The `*.spec.*` suffix, and a top-level `tests/` directory** — `eslint/rules/test-filename.js`,
  wired into `eslint/base.js`. Both bans cover every JS/TS extension and neither covers `.svelte`. A
  trailing block switching `no-restricted-syntax` off is what can still take it away.
- **Magic numbers** — `@typescript-eslint/no-magic-numbers`; **`any`, unused vars, floating promises
  and explicit param and return types** — `eslint/rules/typescript.js` and `eslint/rules/promise.js`.
- **Identical functions and repeated string literals** — `eslint/rules/sonarjs.js`.
- **The quality limits** — `eslint/rules/code-quality.js` and `eslint/rules/sonarjs.js`, stated once
  in `CLAUDE.md` and pinned against the rule objects by `eslint/quality-limits-document.test.ts`.
- **`function` syntax rather than an arrow const** — `func-style: declaration` in
  `eslint/rules/code-quality.js`; `eslint/base.js` allows the typed-const idiom only in the SvelteKit
  route, hook and param-matcher files (joshuafolkken/kit#3294).
- **The early-return one-liner** — `local/early-return-one-liner` (`eslint/rules/early-return-one-liner.js`),
  for a lone `return` whose one-liner fits the print width (joshuafolkken/kit#3294).

What lint cannot see, and why each is the reader's:

- **Duplication that is not identical** — `sonarjs/no-identical-functions` sees only functions that
  match.
- **A name that satisfies the convention and says the wrong thing** — `naming-convention` checks the
  shape, never the meaning.
- **Grouping and layout**, **Svelte semantics**, and **test placement beyond the two banned patterns**
  — a `tests/Foo.svelte`, a test away from the code it exercises, or an `*.e2e.ts` outside
  `src/routes/**` all lint clean.
