import { read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1714: `backlogrun` is the entry point built to run unattended, and it stopped at
// every session cut to wait for a person to retype the keyword — roughly every 50 minutes, against a
// declared budget of eight hours. The decision recorded on that issue is **B**: a cut is an execution
// detail of the same authorization, not a new one.
//
// The reading is a rule, so it has to be readable from every document a run consults, and the three
// below are consulted in different situations: `SKILL.md` → §0 is where the explicit-invocation rule
// is single-sourced and so is where the qualification belongs, `backlogrun.md` carries the procedure,
// and `epicrun.md` states the hand-off the reading deliberately does **not** change. A rule written in
// one of them is a rule the run reading another never reaches — which is what these markers pin.
//
// **`CLAUDE.md` is deliberately not among them.** The resident budget had 1,050 bytes free against
// the 1,000-byte guard floor `scripts/workflow-skills.test.ts` asserts, so no formulation of this
// rule fits, and `prompts/collaboration-workflow/residency.md` → "上限を引き上げてよい条件" makes
// raising the ceiling Tier C and requires a measured recovery pass first. The resident §0 already
// names `SKILL.md` → §0 as this rule's single source, so the two do not contradict; adding the
// resident line is tracked separately rather than paid for by deleting an unpinned sentence, which is
// the failure joshuafolkken/kit#1275 wrote that floor to prevent.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const BACKLOGRUN = '.claude/skills/workflow-commands/backlogrun.md'
const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'
const COMMAND_DOC = 'docs/josh-commands.md'

const CARRY_COMMAND = 'run:carry'
const CARRY_ALIAS = 'rc'

// §0 is where the explicit-invocation rule is single-sourced, so the reading has to sit beside it
// rather than only downstream — and it has to say that the "earlier turn" bullet above it still
// stands, since that bullet is what a reader would otherwise take the reading to have repealed.
const SKILL_MARKERS: ReadonlyArray<string> = [
	'A session cut inside a declared budget is not a new invocation** (joshuafolkken/kit#1714)',
	'no budget left, or none begun, has nothing to carry',
	'an `epicrun` or `fullrun` cut still waits for the keyword',
]

// The procedure. Every marker here is a step a run would otherwise have to invent: where the record
// is asked, what feeds `backlog:budget` from it, which guards it makes span a cut, what the
// completion report owes the reader, and the invariant the record does not touch.
const BACKLOGRUN_MARKERS: ReadonlyArray<string> = [
	'## The session cut is inside the invocation',
	'The authorization boundary is carried by the budget, not by the keystroke.',
	'pnpm josh run:carry --begin',
	'`--started` takes the record',
	// The figure is deliberately not in the marker. It lives in `backlog-budget.ts` now, and pinning
	// "8-hour" here would make a raised budget fail this test instead of updating the prose with it.
	'whole-run bound count **across** cuts',
	'The 10-filings-per-run ceiling is counted the same way',
	'How many cuts the run crossed is named in the completion report',
	'a resumed session is offered exactly the issues the first one was',
	'and a lane never touches it',
]

// The hand-off is `epicrun.md`'s, and the reading is scoped away from it on purpose. Without this the
// two documents disagree in writing, and a run reading only the hand-off would carry a `backlogrun`
// budget into a stop that was never meant to end it.
const EPICRUN_MARKERS: ReadonlyArray<string> = [
	'`backlogrun` is the one entry point where the cut does not stop the run',
	'an epic declares which children may run, never how much of a budget',
]

// The command reference carries the behavior a loop branches on. The two beyond the heading are the
// ones a rewrite loses first, because both are refusals rather than features.
const COMMAND_DOC_MARKERS: ReadonlyArray<string> = [
	'### `josh run:carry`',
	'A live record is never replaced, and never resumed into by something else.',
	'Every counter is an increment, never a total.',
]

describe('the workflow skill states it beside the rule it qualifies', () => {
	const content = read_unwrapped(SKILL)

	it.each(SKILL_MARKERS)('says %s', (marker) => {
		expect(content).toContain(marker)
	})
})

describe('backlogrun.md carries the procedure the reading needs', () => {
	const content = read_unwrapped(BACKLOGRUN)

	it.each(BACKLOGRUN_MARKERS)('says %s', (marker) => {
		expect(content).toContain(marker)
	})
})

describe('epicrun.md scopes the reading away from its own hand-off', () => {
	const content = read_unwrapped(EPICRUN)

	it.each(EPICRUN_MARKERS)('says %s', (marker) => {
		expect(content).toContain(marker)
	})
})

describe('the command reference documents the record itself', () => {
	const content = read_unwrapped(COMMAND_DOC)

	it.each(COMMAND_DOC_MARKERS)('says %s', (marker) => {
		expect(content).toContain(marker)
	})
})

describe('the command is reachable by the name the documents use', () => {
	it('is registered in the command map', () => {
		expect(COMMAND_MAP[CARRY_COMMAND]).toBeDefined()
	})

	it('answers to the short alias the reference prints', () => {
		expect(ALIASES[CARRY_ALIAS]).toBe(CARRY_COMMAND)
	})
})
