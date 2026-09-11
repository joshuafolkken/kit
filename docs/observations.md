# Observation ledger

**This file is where a mid-run observation goes when it is real but has not yet blocked anything.**
Before it existed such an observation had two destinations — an Issue or nothing — and
`SKILL.md` → §2i's depth test sends most of them to "not filed". Dropped, the fact that the same
thing was seen twice was never recorded anywhere, so every sighting looked like the first one and the
depth gate was walked past instead of held (joshuafolkken/kit#1728).

**The line format, the identity key, the count that decides a repeat and the promotion that follows
it are all defined in `.claude/skills/workflow-commands/SKILL.md` → §2i, which is their single
source.** They are written there rather than here because that skill is distributed to every
repository consuming this package while `docs/` is not, and a consumer's ledger has to be shaped by a
rule the consumer actually receives.

**The ledger is append-only.** A line is never edited and never deleted, because the count of lines
carrying one key is exactly what says whether an observation has recurred. A second sighting is a
**second line with the same key**, not a rewrite of the first.

**A merge conflict here is resolved by keeping both sides.** Two branches appending at once is the
ordinary case, and a repeated key is the whole signal this file carries — resolving the conflict by
dropping either side destroys exactly what it exists to record.

## Ledger

<!-- Append only. Newest at the bottom. One observation per line; the format is SKILL.md → §2i. -->

- k:investigation-guard-verification-log | d1 | 2026-09-11 | pnpm josh investigation:guard | Reading a background gate run's own output file was refused as investigating an unedited subject file, costing a round trip each time
- k:scripts-cli-near-line-limit | d1 | 2026-09-11 | scripts/epic/epic-bundle-cli.ts | Two scripts CLI files sit past the near threshold at 277 and 259 of 300 code lines, so the next feature touching either owes a splitting plan
- k:open-issue-listing-reader-duplicated | d1 | 2026-09-11 | scripts/issue/issue-depth-share-cli.ts | The fetch-then-undefined-check-then-read-json-listing shape now stands in four places, each returning a different type, so no single reader has been extracted
- k:wake-worst-case-near-cut-interval | d1 | 2026-09-11 | pnpm josh run:wake | Worst case from a cut to the warning is about 40 minutes against a measured cut interval of about 50, so a lost wake costs most of a cycle
- k:issue-labels-individual-exports | d1 | 2026-09-11 | scripts/git/issue-labels.ts | The module exports functions individually rather than through a namespace object, and a third one was added rather than converting the existing two
- k:unit-tests-near-timeout-under-load | d1 | 2026-09-11 | pnpm josh test:unit | Four unit tests sit at 1.6-2.8 s against the 10 s budget and inflate about 12x under full-suite parallelism, so a heavier machine load puts them in the band that reddened an unrelated gate
- k:vitest-worker-spawn-overhead | d1 | 2026-09-11 | pnpm josh test:unit | Vitest reports 687 workers spawned at about 101 ms each and estimates 6.81 s saved with isolation off, roughly a quarter of the unit stage
