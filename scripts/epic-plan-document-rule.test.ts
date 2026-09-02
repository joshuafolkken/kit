import { AI_DOCS, read_unwrapped, read_unwrapped_rule_surface } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#862: front-loading the decisions only works if three things survive a reword —
// the audit runs before the batch, the batch is one question for the whole epic, and recording an
// answer clears the child's park. Losing the first makes decisions on a contradictory plan; losing the
// second asks the same question per child; losing the third leaves a child stopped after the answer
// arrived.
//
// joshuafolkken/kit#1189: the `epic:plan` body is single-sourced into the skill and the canonical
// topic file is now a pointer to it (the joshuafolkken/kit#1174 pattern). The canonical was formerly a
// Japanese full copy pinned phrase by phrase here; those assertions are replaced by the pointer suite
// at the bottom, and the five things only the canonical carried moved into the skill with the body.

const SKILL = '.claude/skills/epic-commands/SKILL.md'
const POINTER = 'prompts/collaboration-workflow/epic-plan.md'
const EPICRUN_SKILL = '.claude/skills/workflow-commands/epicrun.md'

// The procedure lives in the `epic-commands` skill, so these are checked across the rule surface —
// the AI document plus every distributed skill — rather than against one file.
const SURFACE_MARKERS: ReadonlyArray<string> = [
	'`josh epic:plan <E>`',
	'Phase 0 is not optional',
	'one question for the whole epic',
	'`## Decisions` and a comment on each child',
	// The three triage classes, pinned one by one. Matching them as a single run of prose is what
	// let a fold-in that inserted a clause after `auto` drop `ask` and `defer` out of every
	// assertion here while the suite stayed green.
	'| `auto` | Tier A',
	'| `ask` | Tier B/C',
	'| `defer` | Out of scope for this epic',
]

// The half that binds outside the command: the answer arrives, and the child's park has to be cleared.
const RESIDENT_MARKERS: ReadonlyArray<string> = [
	"recording a decision removes that child's `needs-decision` label",
]

// The four phases in order; a document that keeps the command but loses the ordering describes a
// batch decision made before the audit that is supposed to precede it.
const PHASE_MARKERS: ReadonlyArray<string> = [
	'phase 0 → epic:audit',
	'phase 1 → read the plan',
	'phase 2 → put every',
	'phase 3 → epicrun',
]

// The section format, which is what makes a decision readable months later.
const DECISION_FORMAT_MARKERS: ReadonlyArray<string> = [
	'## Decisions',
	'- 対象:',
	'- 採用:',
	'- 却下:',
	'- 理由:',
	'- 決定日:',
]

describe('epic:plan documentation', () => {
	it.each(AI_DOCS)('is reachable from %s', (document_name) => {
		const surface = read_unwrapped_rule_surface(document_name)

		for (const marker of SURFACE_MARKERS) expect(surface).toContain(marker)
	})

	it.each(AI_DOCS)('keeps the label-clearing rule resident in %s', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of RESIDENT_MARKERS) expect(content).toContain(marker)
	})

	it('names the four phases in order', () => {
		const content = read_unwrapped(SKILL)
		const positions = PHASE_MARKERS.map((marker) => content.indexOf(marker))

		expect(positions.every((position) => position !== -1)).toBe(true)
		expect(positions).toEqual(positions.toSorted((left, right) => left - right))
	})

	it('defines the shape a decision is recorded in', () => {
		const content = read_unwrapped(SKILL)

		for (const marker of DECISION_FORMAT_MARKERS) expect(content).toContain(marker)
	})
})

// joshuafolkken/kit#1189: what only the canonical carried has to exist at the single source before
// the canonical is shrunk, or the rollout deletes rules instead of moving them. One assertion per
// item, so a failure names the sentence that went missing rather than "the skill changed".
const FOLDED_IN_MARKERS: ReadonlyArray<[string, string]> = [
	['the alias', 'pnpm josh el <E>'],
	['what the phase 0 audit looks for', 'an implicit dependency, and a child no task list tracks'],
	['that its findings are fixed as Tier A', 'Fix what it finds as Tier A, without asking'],
	['where the reasoning is recorded', 'record the reasoning on the Issue'],
	['which contradictions reach phase 2', "needs a person's judgement joins phase 2's `ask`"],
	['why phase 0 is not skippable', 'not a confirmation that may be skipped'],
	['when an `auto` decision is written down', 'record it when the child is implemented'],
	['what makes a decision `auto`', 'one option is clearly better on the merits'],
	['what makes a decision `ask`', 'the top options are close, or the action is irreversible'],
]

describe('what only the canonical carried now lives at the single source', () => {
	it.each(FOLDED_IN_MARKERS)('the skill states %s', (_description, marker) => {
		expect(read_unwrapped(SKILL)).toContain(marker)
	})

	// The label-clearing rule is defined by `epicrun`, and the fold-in says so rather than restating
	// it. A citation naming a file that no longer defines it would send the reader nowhere.
	it('cites the file that defines the label-clearing rule', () => {
		expect(read_unwrapped(SKILL)).toContain(EPICRUN_SKILL)
		expect(read_unwrapped(EPICRUN_SKILL)).toContain('Removing the label is Tier A')
	})
})

// joshuafolkken/kit#1189: the canonical topic file is a pointer to the skill single source, not a
// second copy. The pointer test names the source; the body test proves the Japanese full copy that
// used to live here — pinned phrase by phrase above until this rollout — has not crept back.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const POINTER_MARKERS: ReadonlyArray<string> = [SKILL, 'クローン禁止・単一ソース化']
	const REMOVED_BODY_MARKERS: ReadonlyArray<string> = [
		'矛盾を抱えた計画に対して一括決定を行っても、決定ごと作り直しになる',
		'省略可能な確認ではない',
		'EPIC 全体で 1 回の質問',
		'片方だけでは後から辿れない',
		'これが無いと、判断が返ったのに子が永久に止まる',
	]

	it('names the skill as the single source', () => {
		const content = read_unwrapped(POINTER)

		for (const marker of POINTER_MARKERS) expect(content).toContain(marker)
	})

	it('does not duplicate the rule body', () => {
		const content = read_unwrapped(POINTER)

		for (const marker of REMOVED_BODY_MARKERS) expect(content).not.toContain(marker)
	})

	// The skill's own opening named this topic file as the canonical extended reference, which is the
	// citation that made the body a thing to write twice. Its removal is the half of the conversion
	// that `pointer-citation-document-rule.test.ts` cannot check, since a pointer's own skill is
	// exempt there.
	//
	// The enumeration is what is read, not the whole opening: the sentence right after it says the
	// topic file has *become* a pointer, and naming it there is correct. Bounding the match to the
	// enumeration also keeps the assertion about the routing decision rather than about one spelling
	// of the file name — an equivalent rewording that still listed the topic file as canonical would
	// pass a check pinned to one spelling of the base name.
	it('is no longer listed among the skill’s canonical extended references', () => {
		const ENUMERATION = /canonical extended reference is(.*?)between them/su
		const names = ENUMERATION.exec(read_unwrapped(SKILL))?.[1]

		expect(names).toBeDefined()
		expect(names).not.toContain('epic-plan')
	})
})
