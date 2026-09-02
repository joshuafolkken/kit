import { describe, expect, it } from 'vitest'
import {
	CANONICAL_DOC,
	read_repo_file,
	read_unwrapped,
	WORKFLOW_PROMPT,
} from './ai-document-fixture'

// joshuafolkken/kit#1219: the round cap stopped the loop at two, but the second round asked the
// first round's question — read the whole diff adversarially — inside a document whose opening line
// forbids declaring anything clean without proof. Two readings of one diff under that instruction
// return different findings whether or not the code changed, so a Medium stood at the second round
// even where the fixes were sufficient and the three-way disposition ran every single time.
//
// The correction is to change the question rather than the standard: the second round verifies the
// fixes. Each marker below is one part of that definition, and dropping any one of them puts the
// artificial findings back — without the scope the whole diff is read again, without the question it
// is the same review, without the severity sentence the narrowing reads as a relaxation, and without
// the convergence note the fix delta has no reason to shrink.
const REVIEW_PROMPT = 'prompts/review.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const SECTION_TITLE = 'The second round is a verification pass, not a second full review'
// Shared by both absence suites: the retired wording is asserted gone from two files, and the case
// name is the same sentence in each.
const RETIRED_CASE = 'no longer says %j'

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_TITLE}`,
	// The re-run is announced as something other than this review, at the point the cap is stated.
	'**The re-run is not this review a second time.**',
	// The four axes the pass redefines.
	"the **fix delta**: what the first round's fixes wrote",
	'did each first-round finding actually close, and did the fix itself introduce a defect?',
	'category 1 (Bug risks & logic errors), plus the categories the fix delta actually touches',
	'one line per first-round finding with its resolution',
	// Narrowing what is read is not narrowing what counts.
	'**A first-round finding the fix did not close is still a finding, at its original severity.**',
	// The High rules survive the narrowing verbatim; kept here because the pass is where a reader
	// most easily assumes the cheaper round is also the softer one.
	'**What changes is the question, never the standard.**',
	'A confirmed High still blocks the merge whatever the round count',
	// Why this is the existing branch-1 rule generalized rather than a new exemption.
	'**This is a generalization of a rule already written, not a relaxation of one.**',
	'**It converges because the fix delta shrinks.**',
]

// The three places the first round's own instructions would otherwise contradict the pass: the
// default hypothesis, the output template, and the all-nine category list. Each one is stated
// unconditionally, so each needs the second round carved out of it by name.
const SCOPED_FIRST_ROUND_MARKERS: ReadonlyArray<string> = [
	'**In the second round that hypothesis is aimed at the fix delta, not at the whole diff again.**',
	"**This is the first round's format.**",
	'**The second round checks category 1 plus the categories its fix delta actually touches**',
]

// The wording the pass replaces, asserted absent. A surviving copy tells the agent to run the first
// round again, which is the instruction this change exists to remove — and two instructions that
// disagree leave the agent to pick.
const RETIRED_MARKERS: ReadonlyArray<string> = [
	'fix them in place and re-run `/code-review` at the level `pnpm josh review:level` prints. Nothing is committed yet',
]

describe(`${REVIEW_PROMPT} — the second round is defined`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(CANONICAL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(SCOPED_FIRST_ROUND_MARKERS)('scopes the first round instruction %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(RETIRED_MARKERS)(RETIRED_CASE, (marker) => {
		expect(content).not.toContain(marker)
	})
})

// The skill is what a run reads at the moment the review settles, so the decision table and the
// turn-end self-check are where the pass has to be named — a run that reads only the skill would
// otherwise re-run the first round and never reach the definition above.
const CHAIN_RULE_MARKERS: ReadonlyArray<string> = [
	'second-round verification pass',
	// joshuafolkken/kit#1241: the pass used to be described as "scoped to the fix delta" and nothing
	// handed the delta over, so the scoping was a sentence in a document the forked review agent never
	// opens. The marker follows the mechanism rather than the description.
	'which hands over the **fix delta** as the target',
	'pnpm josh review:brief --round 2',
	'**not** a second adversarial read of `git diff main`',
	'The question narrows; the standard does not',
	SECTION_TITLE,
]

const CHAIN_RULE_RETIRED: ReadonlyArray<string> = [
	'Fix in place and re-run `/code-review` at the level `pnpm josh review:level` prints on `git diff main`',
]

describe(`${CHAIN_RULE} — the run's own copy names the pass`, () => {
	const content = read_unwrapped(CHAIN_RULE)

	it.each(CHAIN_RULE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(CHAIN_RULE_RETIRED)(RETIRED_CASE, (marker) => {
		expect(content).not.toContain(marker)
	})
})

// The two places that state the loop *without* reading `prompts/review.md` first: the skill's
// verification-gate bullet, which is the first thing every workflow command reads, and the resident
// gate and pre-commit rules, which are the only rules text a standalone self-review has in context.
// Both told the reader to produce the full categorized output every round, so a run following either
// one literally re-ran the first round while the skill's own decision table said not to.
const GATE_BULLET = '.claude/skills/workflow-commands/SKILL.md'
const CARVE_OUTS: ReadonlyArray<readonly [string, string]> = [
	[
		GATE_BULLET,
		'the second one a verification pass over the fixes rather than a second full read of the diff',
	],
	[
		CANONICAL_DOC,
		'the second one a verification pass over the fixes rather than a second full read',
	],
	[CANONICAL_DOC, '**the second round is a verification pass over the fix delta**'],
]

describe('the loop is stated with the pass wherever it is stated at all', () => {
	it.each(CARVE_OUTS)(
		'%s carves the second round out of the first round format with %j',
		(path, marker) => {
			expect(read_unwrapped(path)).toContain(marker)
		},
	)
})

// The Japanese pointer states the review step's scope as `git diff main`, which reads as the whole
// diff every round. It carries the pass by name so the two documents do not disagree; the definition
// itself stays in `prompts/review.md`.
const WORKFLOW_PROMPT_MARKERS: ReadonlyArray<string> = [
	'2 周目は 1 周目の反復ではなく、修正の検証パスである',
	'閉じていない指摘は元の severity のまま残る',
	SECTION_TITLE,
]

describe(`${WORKFLOW_PROMPT} — the pointer agrees`, () => {
	const content = read_repo_file(WORKFLOW_PROMPT)

	it.each(WORKFLOW_PROMPT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
