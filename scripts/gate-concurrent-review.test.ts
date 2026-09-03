import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1242: `pnpm josh gate` and `/code-review` read the same tree and neither writes to
// it, yet every entry point paid for them one after the other — measured at 187 seconds across four
// gate runs of a 1623-second run, with two of them sitting directly in front of a review round.
//
// The correction is the treatment `josh eval` already had: started when the review starts, joined
// before the commit. Each marker below is one part of that, and dropping any one of them puts back a
// state the change exists to remove — without the start the waiting returns, without the join a run
// can reach a commit on a gate nobody read, and without the third brief state a running gate reads to
// the forked review agent as "no gate ever ran" and it re-runs the unit suite anyway.
const REVIEW_PROMPT = 'prompts/review.md'
const GATE_BULLET = '.claude/skills/workflow-commands/SKILL.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const HALFRUN = '.claude/skills/workflow-commands/halfrun.md'
const DOCS = 'docs/josh-commands.md'

// The one sentence every entry point's procedure has to carry, so a run reading only its own file
// still starts the two together. Asserted per file rather than once, because each of these is read
// on its own.
const START_TOGETHER = 'and the review together, and join the gate before the'

const PROCEDURE_FILES: ReadonlyArray<string> = [FULLRUN, HALFRUN]

describe('every implementing entry starts the gate beside the review', () => {
	it.each(PROCEDURE_FILES)('%s says so in its own procedure', (path) => {
		expect(read_unwrapped(path)).toContain(START_TOGETHER)
	})
})

// The skill's verification-gate bullet is the first thing every workflow command reads, and it is
// where the ordering is stated for all of them at once.
const GATE_BULLET_MARKERS: ReadonlyArray<string> = [
	'is *started* when the review starts, and *joined* before the commit',
	'neither the gate nor the review writes to the working tree',
	'**Joining the gate is a step, not a formality — there is no path to a commit on a gate nobody read.**',
	'a red one is fixed and re-run **whatever the review concluded**',
	'and that sentence claims no result',
]

describe(`${GATE_BULLET} — the gate bullet states the new order`, () => {
	const content = read_unwrapped(GATE_BULLET)

	it.each(GATE_BULLET_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The chain rule is what a run reads at the moment the review settles — the exact point at which the
// gate's result is still outstanding and the next command would be `bump minor`.
const CHAIN_RULE_MARKERS: ReadonlyArray<string> = [
	'**Join the gate before `pnpm josh bump minor` — every row of the table below runs after that, not instead of it.**',
	'**A red gate is fixed and re-run whatever the review concluded**',
	'**There is no row here that reaches a commit on a gate nobody read.**',
]

describe(`${CHAIN_RULE} — the merge chain joins the gate first`, () => {
	const content = read_unwrapped(CHAIN_RULE)

	it.each(CHAIN_RULE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The three brief states, defined once in `prompts/review.md` and described for the command in
// `docs/josh-commands.md`. The middle one is the whole addition: it forbids the re-run without
// asserting a pass, and a document that blurred the two would license the report this repository
// refuses to make.
const REVIEW_PROMPT_MARKERS: ReadonlyArray<string> = [
	'### The gate runs beside this review, not in front of it',
	'**So the brief has three states, not two**',
	'`Running now`',
	'**`Running now` forbids a re-run without asserting a pass, and the distinction is the whole point.**',
	'**Joining is a step of the run, not a formality.**',
	'lands in the round-2 fix delta and is reviewed with the rest',
]

describe(`${REVIEW_PROMPT} — the third state is defined`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(REVIEW_PROMPT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

const DOCS_MARKERS: ReadonlyArray<string> = [
	'**A gate still running is its own answer**',
	'clears it on the way out, green or red',
	'**no result is claimed**',
]

describe(`${DOCS} — the command reference carries the state`, () => {
	const content = read_unwrapped(DOCS)

	it.each(DOCS_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The two documents that state the loop *without* reading `prompts/review.md` first: the resident
// completion gate, which is the only rules text a standalone self-review has in context, and the
// canonical Japanese workflow topic. Both spelled the gate as the step before the review, so a run
// following either literally would have paid for them one after the other while the skill said not to.
const CANONICAL_MARKERS: ReadonlyArray<readonly [string, string]> = [
	['CLAUDE.md', '**Inside a workflow it is _started_ with step 3 and _joined_ before the commit**'],
	[
		'prompts/collaboration-workflow/plan-comment.md',
		'**`pnpm josh gate` をレビューと同時に開始し、コミット前に join する**',
	],
]

describe('the resident and canonical documents agree with the skill', () => {
	it.each(CANONICAL_MARKERS)('%s states %j', (path, marker) => {
		expect(read_unwrapped(path)).toContain(marker)
	})
})
