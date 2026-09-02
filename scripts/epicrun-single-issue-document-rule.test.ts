import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#892: `epicrun` used to require an epic, so work already expected to grow needed
// a person to build one first. Widening the entry point costs one confirmation, and the parts a
// reword loses are the ones that keep that from becoming a license: the run does not stop on a split
// (which is the whole point), it does not create an epic when nothing turned up (which would leave
// an epic the auto-close cannot close), and `fullrun` does NOT inherit any of it — a `fullrun` that
// promoted itself would merge a batch on one Issue's authorization.

const SKILL = '.claude/skills/workflow-commands/epicrun.md'
const ENTRY_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const SPLIT_SKILL = '.claude/skills/workflow-commands/split-assessment.md'
const EPIC_NEXT = 'scripts/epic/epic-next.ts'
const REJECTION_MESSAGE = 'tracks no children in a task list.'

// Read from each document itself rather than from the rule surface: the surface concatenates every
// distributed skill, so a marker checked there would pass on the skill's copy alone.
//
// joshuafolkken/kit#951 moved the branch into the skill — it binds only once `epicrun` has been
// typed and the skill read — so what the documents owe is the routing: the widening is named, and
// the canonical section is named. The branch itself is asserted against the skill below.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'Three rules decide what a run does when the work turns out not to be one Issue',
	'`epicrun` accepting an Issue that is not an epic',
	// joshuafolkken/kit#1188 made the canonical topic file a pointer, so the routing names the skill
	// section that now holds the body. A citation names the file the body is in
	// (joshuafolkken/kit#1178).
	'`epicrun.md` → "When `#N` is not an epic"',
]

const SKILL_MARKERS: ReadonlyArray<string> = [
	'## When `#N` is not an epic',
	'**Do not stop.**',
	'**Nothing found means no epic.**',
	'**Every guard below applies on this path unchanged**',
	// Without this sentence the branch reads as permission for `fullrun` to widen itself.
	'**This does not let `fullrun` promote itself.**',
	'it still files the children and the epic and then **stops**',
	'an epic holding one closed Issue is noise',
	// The three defects the first review of joshuafolkken/kit#892 found in this branch: it skipped
	// the two steps the prerequisite section calls load-bearing, and it wrote the epic's arguments
	// in an order that records the dependency backwards.
	'**Stash the work in progress and remove `in-progress` from `#<N>`**',
	'because `--ordered` makes the argument order the dependency chain',
	'the prerequisite comes **first**',
	'always takes the keep-as-a-child arm',
	// A split has no prerequisite, so the `--ordered` form would serialize independent children.
	'**no `--ordered`**',
	// `epic:audit` refuses a bare Issue exactly as `epic:next` does, and the audit step runs first.
	'**Run `pnpm josh epic:audit <E>` now**, not earlier.',
	'`git stash push -u -m "..."` with the `-u`',
	// Folded in from the canonical topic file when it became a pointer (joshuafolkken/kit#1188): the
	// reason the entry point exists at all is *when* the one human action is spent, not how many of
	// them there are. Nothing else pinned it once the Japanese section was cut.
	'The point is *when* the person is involved.',
]

describe('epicrun single-issue entry', () => {
	it.each(AI_DOCS)('is routed to from %s, by name and by section', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	// There is deliberately no canonical-corpus case here. The Japanese section this suite used to
	// assert against became a pointer under joshuafolkken/kit#1188, and what it alone carried moved
	// into `SKILL_MARKERS` above rather than being dropped. That the pointer stays a pointer is
	// `epicrun-document-rule.test.ts`'s job.
	it('carries the operational branch in the skill', () => {
		const content = read_unwrapped(SKILL)

		for (const marker of SKILL_MARKERS) expect(content).toContain(marker)
	})
})

describe('epicrun single-issue entry — what it must not have widened', () => {
	// A reader who arrives at the skill's opening line has to learn that a bare Issue is accepted;
	// the branch is far enough down the file to be missed otherwise.
	it('says so where the skill introduces the command', () => {
		expect(read_unwrapped(SKILL)).toContain('It also accepts an Issue that is **not** an epic')
	})

	// The widening is deliberately confined to `epicrun`. `epic:next` still answers only about an
	// epic, and the documents say so — a reader who assumed otherwise would look for a defect in a
	// command that is behaving as specified.
	it('leaves the epic:next rejection in place, in the code and in the documents', () => {
		expect(read_repo_file(EPIC_NEXT)).toContain(REJECTION_MESSAGE)
		expect(read_unwrapped(SKILL)).toContain('`josh epic:next` is not changed by any of this.')
	})

	// `fullrun` stopping on a split is the one human touch point in the epic flow; this Issue widened
	// a different entry point and must not have removed it.
	it('leaves the fullrun stop on a split intact', () => {
		const content = read_unwrapped(SPLIT_SKILL)

		expect(content).toContain('## Finding a split mid-run stops the run')
		expect(content).toContain('they do not silently become an `epicrun`')
	})

	// The split assessment lists what each entry does with the answer, and an entry that behaves
	// differently while going unmentioned there reads as a contradiction between two skills.
	// The dispatch table is how a run learns which files to read, and this path is defined in terms
	// of a mid-run split — a row that omits the split assessment sends the run in without it.
	it('routes epicrun to the split assessment, and drops the one-difference framing', () => {
		const content = read_unwrapped(ENTRY_SKILL)

		expect(content).toContain('**`epicrun` differs on two points.**')
		expect(content).toContain('| `epicrun #E` | `epicrun.md` + `split-assessment.md`')
	})

	it('records the exception where the split assessment is defined', () => {
		const content = read_unwrapped(SPLIT_SKILL)

		expect(content).toContain('## `epicrun` is the one entry that does not stop')
		expect(content).toContain('only what follows the answer differs')
	})
})
