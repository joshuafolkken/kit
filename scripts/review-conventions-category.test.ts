import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1221: category 4 told the reviewer to "Verify **every** rule below" and then
// listed naming, function syntax, file names, magic numbers, the seven quality limits and
// duplication — every one of which ESLint fails as an error before the review starts, and several of
// which `pnpm josh format:edited` has already fixed in place. Re-verifying them inflated the first
// round, and this document's own account of the loop is that every finding produces a fix and every
// fix produces new surface for the second round.
//
// The correction splits the category rather than deleting it: what lint decides is named as settled,
// and what only a reader can see is listed explicitly. Both halves are asserted — without the first
// the re-verification comes back, and without the second the split reads as having dropped the
// category, which is what would let a `export default` ship unseen.
const REVIEW_PROMPT = 'prompts/review.md'

const GATE_PREMISE_MARKERS: ReadonlyArray<string> = [
	'**The gate has already run — do not re-verify what lint enforces.**',
	'`pnpm josh gate` precedes this review',
	'has already failed as an error or been corrected before you read the diff',
	'**Settled by lint, and therefore not checked here**',
	// The list is only worth anything if each entry names the rule it rests on. Written without them,
	// the first draft moved four unenforced conventions into "settled" and one enforced one out.
	'each one verified against the rule that enforces it, never assumed',
	'`import/no-default-export` is `error` project-wide',
]

// What no rule in this configuration decides. The arrow-function pair is the load-bearing entry:
// there is no `func-style` and no arrow selector anywhere in `eslint/`, and the named-export selector
// exempts `ArrowFunctionExpression` outright, so both halves of the `CLAUDE.md` rule rest on this
// review alone. The first draft of this section put `export default` here instead and called it
// unguarded; `import/no-default-export` is `error` project-wide, so the classification was inverted
// at both ends and each entry is now pinned against the rule that was actually read.
const READER_ONLY_MARKERS: ReadonlyArray<string> = [
	'**What only a reader can see — check these:**',
	'**`function` syntax rather than an arrow const** — **no rule enforces this**',
	'the named-export selector above explicitly exempts `ArrowFunctionExpression`',
	'**The early-return one-liner**',
	'**Duplication that is not identical**',
	'**A name that satisfies the convention and says the wrong thing**',
	'**Svelte semantics**',
	// The rule exists and is exported, but kit never wires it into its own config, so "lint enforces
	// this" is true for a consumer and false here — joshuafolkken/kit#1233 decides which way to fix it.
	'**Test file names and placement**',
	'kit exports that rule for consumers and does not apply it to itself (joshuafolkken/kit#1233)',
	// A settled rule that did not fire is the one gate defect nothing downstream looks at.
	'**A gate finding that got through is still a finding.**',
]

// joshuafolkken/kit#1070 put `eslint/quality-limits-document.test.ts` in front of these numbers: it
// reads each one back out of the rule object that enforces it. The reframing keeps the figures and
// the counting caveat exactly as they were and changes only the instruction around them, so that
// suite stays green — asserted here as well, because a later edit trimming "reference" prose could
// take the numbers with it and only that other file would say so.
const PRESERVED_LIMIT_MARKERS: ReadonlyArray<string> = [
	'**Quality limits**: a reference, enforced by `eslint/rules/code-quality.js` and `eslint/rules/sonarjs.js` rather than re-checked here',
	'**the line counts are code lines, not physical lines**',
	'`skipBlankLines`',
	'`skipComments`',
]

// The instruction the split replaces, asserted absent: left standing it is the opposite rule sitting
// beside the new one, and the reviewer picks.
const RETIRED_MARKERS: ReadonlyArray<string> = [
	'Verify **every** rule below. These are non-standard, so call out any violation.',
]

describe(`${REVIEW_PROMPT} — category 4 assumes the gate`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(GATE_PREMISE_MARKERS)('states the gate premise %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(READER_ONLY_MARKERS)('keeps the reader-only check %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(PRESERVED_LIMIT_MARKERS)('preserves the limit reference %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(RETIRED_MARKERS)('no longer says %j', (marker) => {
		expect(content).not.toContain(marker)
	})
})
