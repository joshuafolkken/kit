import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_unwrapped, WORKFLOW_PROMPT } from './ai-document-fixture'

// joshuafolkken/kit#865: the scope assessment used to live only in `kickoff new`, which is how a
// request that was really three issues could reach a merge as one pull request. Extending it to
// every entry is only safe while every entry applies the *same* condition — a document that keeps
// the assessment but softens "two or more always means an epic" at one entry restores the defect
// in a form that is harder to see.

const SKILL_ROOT = '.claude/skills/workflow-commands'
const EPICRUN_COMMAND = 'epicrun #<E>'
const SHARED_FILE = 'split-assessment.md'
const SHARED = `${SKILL_ROOT}/${SHARED_FILE}`
const FULLRUN = `${SKILL_ROOT}/fullrun.md`
const HALFRUN = `${SKILL_ROOT}/halfrun.md`
const ENTRY_SKILLS: ReadonlyArray<string> = [`${SKILL_ROOT}/kickoff.md`, FULLRUN, HALFRUN]

// joshuafolkken/kit#951 moved the rule itself into the skill: the assessment binds only after a
// command has started, so a document that restated it was spending always-loaded budget on a
// procedure no turn outside a run reads. What the documents still owe is the routing — the rule is
// named, and the run is sent to the one definition — and that is all these markers pin.
//
// joshuafolkken/kit#1178: the canonical topic file's Japanese section title used to be a marker here,
// because the resident text named that file as the "Canonical reference". It is a pointer now, and a
// citation names the file the body is in — so what the resident text owes is the skill path and the
// reason it is cited directly. The negative half (the pointer is cited by nothing) is mechanical and
// lives in `pointer-citation-document-rule.test.ts`, which covers every converted topic at once.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'Three rules decide what a run does when the work turns out not to be one Issue',
	'the split assessment every entry point applies identically',
	SHARED_FILE,
	// joshuafolkken/kit#1185 converted the mid-run prerequisite too, so one clause now covers both
	// single sources rather than this one alone.
	'all three single sources, cited directly because their canonical topic files are now pointers to them',
]

// The entry file summarizes the rule for a run that has loaded the skill but not yet opened the
// shared file; it is the copy that replaced the resident one, so it is asserted like one.
const ENTRY_MARKERS: ReadonlyArray<string> = [
	'**The split assessment** runs before any work starts, at *every* entry point, from the one definition in `split-assessment.md`',
	'Two or more separately-mergeable deliverables always means an epic — no count threshold, no ordering condition',
]

// joshuafolkken/kit#1174: the rule body is single-sourced into the skill and the canonical topic
// file is a pointer to it. The pointer test names the source; the body test proves the Japanese full
// copy that used to live here — the clone this issue removed — has not crept back.
const CANONICAL_POINTER_FILE = 'prompts/collaboration-workflow/split-assessment.md'
const CANONICAL_POINTER_MARKERS: ReadonlyArray<string> = [SHARED, 'クローン禁止・単一ソース化']
const REMOVED_BODY_MARKERS: ReadonlyArray<string> = [
	'2 件以上に分割したら常に epic を作る。件数の閾値も、実行順序の有無による分岐も無い',
	'入口ごとに条件が違う状態は欠陥である',
]

const SHARED_MARKERS: ReadonlyArray<string> = [
	'Does the request contain two or more deliverables that could each be merged separately?',
	// The unconditional rule is the half most easily softened into "a large split gets an epic".
	'Two or more always means an epic',
	'There is no count threshold and no ordering condition to evaluate',
	'**An entry point that applies a different condition is a defect**',
	'Promote, or create a new epic',
	'--promote',
	'Finding a split mid-run stops the run',
	'There is no `kickoff epic`',
	// joshuafolkken/kit#1174 folded the canonical-only #873 note in when the body was single-sourced,
	// so the single source now carries it too.
	'Issues filed separately, found related later',
	'joshuafolkken/kit#873',
]

describe('split assessment', () => {
	it.each(AI_DOCS)('is routed to from %s', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it('is summarized where the skill lists what every command shares', () => {
		const content = read_unwrapped(`${SKILL_ROOT}/SKILL.md`)

		for (const marker of ENTRY_MARKERS) expect(content).toContain(marker)
	})

	it('points the canonical topic file at the skill single source', () => {
		const content = read_unwrapped(CANONICAL_POINTER_FILE)

		for (const marker of CANONICAL_POINTER_MARKERS) expect(content).toContain(marker)
	})

	it('does not duplicate the rule body in the canonical topic file', () => {
		const content = read_unwrapped(CANONICAL_POINTER_FILE)

		for (const marker of REMOVED_BODY_MARKERS) expect(content).not.toContain(marker)
	})

	it('carries one shared definition in the skill', () => {
		const content = read_unwrapped(SHARED)

		for (const marker of SHARED_MARKERS) expect(content).toContain(marker)
	})

	// Every entry has to *route* to the shared file rather than restate the rule, which is what keeps
	// one entry from drifting to a different condition.
	it.each(ENTRY_SKILLS)('routes %s to the shared definition', (skill) => {
		expect(read_repo_file(skill)).toContain(SHARED_FILE)
	})

	// The run entries are the ones the rule was added for; stopping is what keeps a one-issue
	// authorization from silently becoming a batch.
	it.each([`${SKILL_ROOT}/fullrun.md`, `${SKILL_ROOT}/halfrun.md`])(
		'stops %s on a split',
		(skill) => {
			const content = read_unwrapped(skill)

			expect(content).toContain('file the children and the epic and then STOP')
			expect(content).toContain(EPICRUN_COMMAND)
		},
	)
})

describe('epic body execution command', () => {
	// The epic is what `epicrun` takes; a body still printing `queue #N1 #N2 …` would send a reader to
	// the command the epic flow replaced. The canonical prompt is included because its manual-fallback
	// template is the copy a person writes by hand when `josh` is unavailable.
	it.each([SHARED, ...ENTRY_SKILLS, WORKFLOW_PROMPT])('is epicrun in %s', (document_name) => {
		const content = read_unwrapped(document_name)

		expect(content).not.toContain('queue #N1 #N2')
		expect(content).not.toContain('queue #101')
	})

	it('names epicrun in the manual fallback template', () => {
		expect(read_unwrapped(WORKFLOW_PROMPT)).toContain(EPICRUN_COMMAND)
	})
})
