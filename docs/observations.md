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
