import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { ALREADY_DONE_LABEL, NEEDS_DECISION_LABEL, TIER_A_ROUTE_LABEL } from './git/issue-labels'

// joshuafolkken/kit#1679: work that was already done reached the backlog twice, through two gaps
// that had to be closed together.
//
// **Before a filing**, the duplicate scan read open issues only and ran for `new` entry points only —
// so the filing most likely to duplicate something, the one made mid-run about the work the run has
// just been looking at, went through no scan at all. joshuafolkken/kit#1656 is that case: a
// `route:tier-a` filing covering work joshuafolkken/kit#1623 had merged about five hours earlier.
//
// **After one**, a run that verified its Issue was already merged had no exit written anywhere. The
// nearest rule covered a *comment* saying so, not the run's own verification, and the child that hit
// it chose the one thing that is Tier C: it closed the Issue itself.
//
// These markers pin what a reword most easily loses — that the scout's trigger is the filing call
// rather than the keyword, that a closed candidate means something different from an open one, and
// that the exit is a label rather than a close. The label names are pinned through the exported
// constants, so renaming one breaks the document assertion rather than leaving the prose naming a
// label that no longer exists.

const WORKFLOW_SKILL = '.claude/skills/workflow-commands/SKILL.md'

// The document itself rather than the concatenated rule surface: the surface joins every distributed
// skill, so a marker checked there would pass on some other file's copy.
const skill_text = read_unwrapped(WORKFLOW_SKILL)

// Symptom 1 — the scan in front of a filing. Both halves have to be stated: which filings run it,
// and that the scan reaches what closed recently.
const SCOUT_SCOPE_MARKERS: ReadonlyArray<string> = [
	'**Every filing asks two questions before it happens, and one command answers both.**',
	'**Every filing route runs it, not only a `new` entry point**',
	'**The trigger is the `gh api … issues` call, never which keyword started the run**',
	// The two mid-run routes reached the filing call without a `new` entry in front of them, which is
	// the whole of how the gap opened. Each has to carry the step at its own call site, because a run
	// inside §2d or §2i has already been told what to do and never opens §2e.
	'`pnpm josh issue:scout "<title>"` goes in front of that call, exactly as it does for a `new` entry',
	'**Run `pnpm josh issue:scout "<title>"` before the `gh api … issues` call**, as before any other filing',
]

// A closed candidate is not an open one with a different color: the open one hands over a
// `fullrun #<existing>`, the closed one says the work is done and there is nothing to run.
const CLOSED_CANDIDATE_MARKERS: ReadonlyArray<string> = [
	'**A candidate marked `(closed)` is a different answer, and it is the one that was missing.**',
	'the work most likely to be filed twice is the work that just finished',
	'means **the work is already done**, not that it is tracked elsewhere',
	'take the exit in §2g → "When the work turns out to be already merged"',
]

// Symptom 2 — the exit. One section, reached from both directions, and it has to say out loud that
// the two arrive at the same place rather than reading as the run-verified case alone.
const EXIT_HEADING = '### When the work turns out to be already merged'
const EXIT_MARKERS: ReadonlyArray<string> = [
	EXIT_HEADING,
	'**A run can learn its Issue is already done in two ways, and both end here**',
	'the **run itself verifies it**',
	'what is left to do afterwards is identical, so there is one procedure and not two',
	// The comment case must route here rather than keep a second copy of the procedure.
	'takes the exit in the next subsection, "When the work turns out to be already merged"',
]

// What keeps the exit inside Tier C, and what keeps it apart from a park. Losing either sentence
// puts the run back where joshuafolkken/kit#1656 was: a correct verification with nowhere to put it.
const TIER_C_MARKERS: ReadonlyArray<string> = [
	'**closed the Issue itself**, which is Tier C',
	'**Never close the Issue.** That is Tier C at every entry point',
	'**Only a person removes it, by closing the Issue**',
	'**Parking it is not that place either**',
	'the next run repeats the same investigation',
	// The bar that keeps this from becoming a way out of the work.
	'**Nothing about this is a license to skip the work when it merely looks familiar.**',
]

describe(`${WORKFLOW_SKILL} — every filing route runs the scout`, () => {
	// Named per marker rather than looped inside one case: a failure has to say which marker went
	// missing, not only that the first one did.
	it.each(SCOUT_SCOPE_MARKERS)('states the widened trigger: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	// The mid-run Tier A filing is the route the gap was measured on, so the label it carries is
	// pinned through the constant rather than by literal.
	it('names the mid-run Tier A route the gap was measured on', () => {
		expect(skill_text).toContain(TIER_A_ROUTE_LABEL)
	})
})

describe(`${WORKFLOW_SKILL} — a closed candidate points at a different exit`, () => {
	it.each(CLOSED_CANDIDATE_MARKERS)('separates the two answers: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})
})

describe(`${WORKFLOW_SKILL} — the already-merged exit is written once`, () => {
	it.each(EXIT_MARKERS)('states the one exit: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	// Written once means once: a second heading would be two procedures to drift apart, which is the
	// state this Issue was filed against.
	it('carries exactly one already-merged section', () => {
		const headings = skill_text.split(EXIT_HEADING).length - 1

		expect(headings).toBe(1)
	})
})

describe(`${WORKFLOW_SKILL} — the exit does not reach Tier C`, () => {
	it.each(TIER_C_MARKERS)('holds the line: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	// The label is what makes the exit exist at all, and it is not `needs-decision` — a park means
	// "waiting for an answer", and here the answer is already in hand.
	it.each([ALREADY_DONE_LABEL, NEEDS_DECISION_LABEL])(
		'names %s where the two are told apart',
		(label) => {
			expect(skill_text).toContain(label)
		},
	)
})
