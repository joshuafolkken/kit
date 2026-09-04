import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1333: joshuafolkken/kit#1261 and joshuafolkken/kit#1326 hid the CI cycles inside
// the second review round, and what was left was the run's own turn boundary. Reconstructed on
// joshuafolkken/kit#1326 (PR #1327): 134 seconds between all-checks-green and the merge, 19 of them
// nothing at all — the turn that read the round-2 result ended, and a second turn issued the merge.
//
// The correction issues the merge in the turn that reads a clean round 2. Each marker pins one half
// of what keeps that from being a weakening, and dropping any one puts back the state it removes:
//
//   - without the mechanical definition of "clean", the rule reads as a judgement call and a round
//     that fixed something in place merges without its follow-up commit;
//   - without the "nothing is skipped" paragraph, the change reads as dropping the gate join, the
//     eval verdict or the CI wait, none of which it touches;
//   - without the other-path paragraph, joshuafolkken/kit#1326's order looks superseded rather than
//     untouched;
//   - without the round-1 append-check paragraph, the rule reads as a new obligation instead of the
//     one already stated for round 1, applied to the round that ends the run.
const REVIEW_PROMPT = 'prompts/review.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const QUEUE = '.claude/skills/workflow-commands/queue.md'
const HALFRUN = '.claude/skills/workflow-commands/halfrun.md'
const PLAN_COMMENT = 'prompts/collaboration-workflow/plan-comment.md'

// The heading every other document cites, so a shortened pointer still resolves to one section.
const SECTION_POINTER = 'A clean second round issues the merge in the same turn'

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_POINTER}`,
	'**So the turn that reads a clean second round is the turn that issues `pnpm josh followup --merge`.**',
	'**Nothing is skipped — only issued earlier.**',
	'**A round 2 that fixed something in place is the other path, and this section does not apply to it.**',
	'**This is the round-1 append check applied to the round that ends the run.**',
]

describe(`${REVIEW_PROMPT} — the single source states the rule`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(CANONICAL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// What the rule explicitly does not relax, pinned separately: the sentence is the only thing
// standing between "issue the merge earlier" and "read less before issuing it".
const UNWEAKENED_MARKERS: ReadonlyArray<string> = [
	'**It does not authorize shortening the reading either**',
	'the gate joined and green',
	'which `pnpm josh followup --merge` waits on and which still block the merge',
	// A confirmed High takes none of the three exits, so the branch-1 half of the test says nothing
	// about it. Without this half a High that stopped short of being fixed reads as clean.
	'**no confirmed High is standing**',
]

describe(`${REVIEW_PROMPT} — the merge still rests on what it rested on`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(UNWEAKENED_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The instruction, asserted where a run reads it rather than only in the prose above. A file that
// points at the section without stating the instruction leaves a run one file-open short of it.
const POINTER_MARKERS: ReadonlyArray<string> = [
	SECTION_POINTER,
	'**A clean second round is not a turn boundary either**',
	'the turn that reads it issues `pnpm josh followup --merge`',
	'never in a turn of its own',
]

// Every file a run follows on its own. Asserted per file because each is read alone: an instruction
// stated only in the skill's shared bullet never reaches an entry following its own procedure.
const ENTRY_FILES: ReadonlyArray<string> = [SKILL, CHAIN_RULE, FULLRUN, QUEUE]

describe('every entry that merges states the rule in its own file', () => {
	it.each(ENTRY_FILES)('%s states it', (path) => {
		const content = read_unwrapped(path)

		for (const marker of POINTER_MARKERS) expect(content).toContain(marker)
	})
})

// The decision table is where a run maps a review result to its next action mechanically, so the
// row has to exist there and not only in the surrounding prose.
const TABLE_MARKERS: ReadonlyArray<string> = [
	'| Nothing to fix in place — **and this was the second round** |',
	'**Issue the merge in this same turn.**',
	// The two rows the new one sits between. Both were round-agnostic and both matched a clean
	// round 2 on their stated criterion, so a run reading the table mechanically took the first of
	// them and re-bumped a branch whose pull request was already open.
	'**and this was the first round**',
	'**A Low-only second round is this row, not the one below**',
	'**Where this was round 2 and it came back clean, that merge is the whole of the continuation**',
]

describe(`${CHAIN_RULE} — the decision table and the turn-end self-check carry the row`, () => {
	const content = read_unwrapped(CHAIN_RULE)

	it.each(TABLE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// `halfrun` stops before the commit, so it opens no pull request and never issues a merge at all.
// Asserted as an absence because the wording is easy to copy across when the entry files are edited
// together.
describe(`${HALFRUN} — the stop before commit is untouched`, () => {
	const content = read_unwrapped(HALFRUN)

	it.each(POINTER_MARKERS)('never tells a run to issue the merge: %j', (marker) => {
		expect(content).not.toContain(marker)
	})
})

// The canonical Japanese topic, which is what a non-Claude agent following the workflow prompt
// reaches without ever opening `prompts/review.md`. Left unchanged it stops one section short.
const TOPIC_MARKERS: ReadonlyArray<string> = [
	'**2 周目が clean なら、その結果を読んだターンでマージを打つ**',
	'**検証は何ひとつ省かない**',
	'clean かどうかは判断ではなく機械的に決まり、条件は 2 つある',
	'**Low だけが出た周は clean である**',
	SECTION_POINTER,
]

describe(`${PLAN_COMMENT} — the canonical topic agrees`, () => {
	const content = read_unwrapped(PLAN_COMMENT)

	it.each(TOPIC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
