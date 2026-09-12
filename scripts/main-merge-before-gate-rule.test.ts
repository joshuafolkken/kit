import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1837: a lane is cut from `origin/main` at `lane:open` and runs its whole
// implementation, gate and review while the other lanes merge, so `followup` comes back
// `mergeStateStatus: DIRTY` and the conflict is resolved *after* the gate has run on a tree that will
// never exist. Measured at 25.8% of that run. Merging `origin/main` into the branch before the gate
// makes the gate verify the tree that will merge and shrinks the conflict window; the merge is the
// last edit, so the scoped pair and the gate still run once over it (improvement 3, the existing
// "single check answers once per tree" rule reinforced, not a new cap).
//
// Each marker below is one place the rule is read from. The definition lives in one document and the
// other three name it: a copy in the skill is how the two come to say different things, and a rule
// stated only in the review prompt never reaches a run following its own entry procedure.
const REVIEW_PROMPT = 'prompts/review.md'
const GATE_BULLET = '.claude/skills/workflow-commands/SKILL.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'

const SECTION_POINTER = 'origin/main is merged in before the gate'
const SECTION_HEADING = `### ${SECTION_POINTER}, so the gate verifies the tree that merges`

// The rule's single source: the command it names, the direction it merges, why it is the last edit
// (so it adds no rerun), the no-op case, and that a conflict here is the existing lane-conflict
// procedure fired early rather than a new one.
const REVIEW_PROMPT_MARKERS: ReadonlyArray<string> = [
	SECTION_HEADING,
	'# fetch origin/<default>, then merge it into this branch',
	'**Merging, not rebasing**',
	'**The merge is the last edit, so the scoped pair and the gate run once over it, not twice around it.**',
	"**A no-op when nothing advanced, and most of what it saves is a lane's.**",
	'**A conflict here is the "Conflicts are not predicted" procedure fired early, not a new one.**',
]

describe(`${REVIEW_PROMPT} — the rule is defined`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(REVIEW_PROMPT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The skill's shared verification-gate bullet is the one place every implementing entry reads before
// it starts editing, so the sentence a run has to obey is carried there beside the scoped-pair rule
// it follows.
describe(`${GATE_BULLET} — the gate bullet carries the sentence`, () => {
	it.each(['**And `origin/main` is merged into the branch before the gate**', SECTION_POINTER])(
		'states %j',
		(marker) => {
			expect(read_unwrapped(GATE_BULLET)).toContain(marker)
		},
	)
})

// The two `fullrun` gate procedures — the `#N` form and the `new` form — each place the merge in
// front of the gate, so the child that runs `fullrun` executes it.
describe(`${FULLRUN} — both gate procedures place the merge`, () => {
	const content = read_unwrapped(FULLRUN)

	it('names the command', () => {
		expect(content).toContain('`pnpm josh main:merge`')
	})

	it('points at the single source', () => {
		expect(content).toContain(SECTION_POINTER)
	})

	it('places it in both the #N and the new gate procedures', () => {
		const occurrences = content.split('merge `origin/main` into the branch first').length - 1

		expect(occurrences).toBe(2)
	})
})

// The lane conflict-resolution section names the pre-gate merge as its first line of defense, so a
// reader arriving at the post-`followup` path knows it is the fallback.
describe(`${EPICRUN} — the conflict section names the pre-gate merge`, () => {
	const content = read_unwrapped(EPICRUN)

	it.each([
		'**The child merges `origin/main` into its lane before its gate now, so this path is the fallback rather than the first line**',
		SECTION_POINTER,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// Single-sourcing, asserted rather than assumed: the section heading lives in `prompts/review.md`
// and the other three point at it by name. A rule that says two different things in two files is
// worse than one stated once.
const NEVER_DEFINES: ReadonlyArray<string> = [GATE_BULLET, FULLRUN, EPICRUN]

describe('the section is defined once', () => {
	it('lives in the review prompt', () => {
		expect(read_unwrapped(REVIEW_PROMPT)).toContain(SECTION_HEADING)
	})

	it.each(NEVER_DEFINES)('%s does not copy the heading', (path) => {
		expect(read_unwrapped(path)).not.toContain(SECTION_HEADING)
	})
})
