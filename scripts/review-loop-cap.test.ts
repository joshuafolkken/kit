import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_rule_surface, WORKFLOW_PROMPT } from './ai-document-fixture'

// joshuafolkken/kit#876: the verification gate said to re-run the review "until no high/medium
// findings remain", which is not a stopping condition on its own — every fix creates new surface and
// an unbounded review finds something in it. Measured on kit#854 and kit#855: four rounds produced 18
// findings and two produced 19, almost none of them repeats, and many of them about code the previous
// round's fix had just written. The cap is what makes the loop terminate without depending on the
// judgement that failed there, so each of its four parts is asserted rather than assumed.
const REVIEW_PROMPT = 'prompts/review.md'
const CAP_TITLE = 'Review round cap'
const CAP_SECTION = `## ${CAP_TITLE} (2 rounds)`
const CAP_CLAUSE = '**at most two reviews in total**'

// The four parts. Dropping any one of them puts the loop back: without the cap it never ends, without
// the filing rule a deferred finding is lost, without the High exception a real defect ships on a
// round count, and without the third-round branch the answer to a standing High is more rounds.
const CANONICAL_MARKERS: ReadonlyArray<string> = [
	CAP_SECTION,
	'or until two reviews have run in total — the first one included — whichever comes first',
	'filed as a follow-up Issue, and the current Issue completes',
	'A confirmed High is never deferred.',
	'Blocking the merge is not the same as buying more rounds.',
	'do not start a third',
]

const RESIDENT_MARKERS: ReadonlyArray<string> = [
	CAP_CLAUSE,
	// joshuafolkken/kit#1082: the blanket "file every remaining non-High finding" is replaced by the
	// three-way disposition. The resident copy states it as its trigger — fix-in-place, file, or drop —
	// and filing is now one of three exits rather than the only one.
	'place each remaining non-High finding in one of three exits',
	'file it as a follow-up Issue when it reaches a runtime path or needs a decision',
	CAP_TITLE,
]

// The gate used to name `/review`, a skill this package does not ship — the same defect kit#853 fixed
// for `/verify`, one gate over. An agent that cannot invoke the named skill substitutes another one,
// and the one it reaches for returns no severities at all, which is what left the rule above with
// nothing to evaluate.
const RETIRED_SKILL = '`/review`'
const GATE_INVOCATION = // joshuafolkken/kit#966: the level is no longer typed into the documents. What is pinned now is
	// that they route to the command that decides it — a bare `/code-review` would inherit whatever
	// level the previous task used, which is the failure the old pin guarded against.
	'pnpm josh review:level'

describe(`${REVIEW_PROMPT} — the canonical cap`, () => {
	const content = read_repo_file(REVIEW_PROMPT)

	it.each(CANONICAL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The old wording is asserted absent: a surviving copy tells the reader to loop until clean, which
	// is the instruction the cap replaces, and two rules that disagree leave the agent to pick.
	it('no longer promises an unbounded loop', () => {
		expect(content).not.toContain(
			'Re-run after applying fixes until **no high or medium findings remain**.',
		)
	})
})

describe.each(AI_DOCS)('%s — carries the cap where it is always loaded', (document_path) => {
	const content = read_repo_file(document_path)

	it.each(RESIDENT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe.each(AI_DOCS)('%s — the gate names a skill that ships', (document_path) => {
	const surface = read_rule_surface(document_path)

	it('no longer points at the unshipped review skill', () => {
		expect(surface).not.toContain(RETIRED_SKILL)
	})

	// The effort is pinned because `/code-review` reuses the last level typed when none is given: a
	// gate left bare inherits whatever the previous task used, and `high` is documented as broader
	// coverage that "may include uncertain findings" — recall where the gate wants precision.
	it('pins the effort the gate runs at', () => {
		expect(surface).toContain(GATE_INVOCATION)
	})
})

// The first review round of kit#876 found the cap applied to some copies of each parallel rule and
// not others, so the doc set contradicted itself in the places the rule is meant to fire. Every file
// that states the loop is asserted to state its bound, and the retired instruction is asserted absent
// — a surviving "loop until clean" is not a gap, it is the opposite rule sitting beside the new one.
const LOOP_STATING_FILES: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/SKILL.md',
	'.claude/skills/workflow-commands/chain-rule.md',
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/queue.md',
]

describe.each(LOOP_STATING_FILES)('%s — states the loop with its bound', (file_path) => {
	const content = read_repo_file(file_path)

	it('names the cap', () => {
		expect(content).toContain(CAP_CLAUSE)
	})
})

describe.each([REVIEW_PROMPT, WORKFLOW_PROMPT])(
	'%s — retires the unbounded wording',
	(file_path) => {
		const content = read_repo_file(file_path)

		it.each(['Loop until none remain.', 'looping until clean'])('no longer says %j', (marker) => {
			expect(content).not.toContain(marker)
		})
	},
)

describe(`${WORKFLOW_PROMPT} — the extended reference agrees`, () => {
	const content = read_repo_file(WORKFLOW_PROMPT)

	it.each(['再実行は 2 周まで', CAP_TITLE, GATE_INVOCATION])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
