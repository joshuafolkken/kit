import { CANONICAL_DOC, read_unwrapped } from '#scripts/ai-document-fixture'
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
// **`CLAUDE.md` carries it too, since joshuafolkken/kit#1720.** The rule decides whether a run
// continues at all, so it binds on a turn where no skill has been loaded — the residency criterion's
// `yes` — while §0 is reached only after a keyword has been typed. Room for the line was made by
// moving the `PORT_SEED` / `JOSH_REPO_PATHS` behavior prose to the command reference those bullets
// already pointed at, not by relaxing the budget constants, which
// `prompts/collaboration-workflow/residency.md` → "上限を引き上げてよい条件" makes Tier C, and not by
// deleting an unpinned sentence, which is the failure joshuafolkken/kit#1275 wrote that floor to
// prevent.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const BACKLOGRUN = '.claude/skills/workflow-commands/backlogrun.md'
const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'
const COMMAND_DOC = 'docs/josh-commands.md'

const CARRY_COMMAND = 'run:carry'
const CARRY_ALIAS = 'rc'

// joshuafolkken/kit#1722's two ownership answers. Both tables have to carry them — the reference so a
// loop can branch on them, `backlogrun.md` so the run knows to stop — so the row prefixes are named
// once here rather than written twice.
const BUSY_ROW = '| `busy`'
const STANDING_ROW = '| `standing`'

// The scope clause both documents owe the reader. It is the same sentence in each on purpose: a copy
// that softened it in one of them would license exactly the cut the decision does not cover.
const SCOPE_MARKER = 'an `epicrun` or `fullrun` cut still waits for the keyword'

// The precondition. Without it the permission reads as unconditional, and a session resuming a run
// whose budget is spent — or that never declared one — takes it as license to carry on with no
// keyword, which is the one thing the "earlier turn" bullet it sits under still forbids.
const BUDGET_MARKER = 'no budget left, or none begun, has nothing to carry'

// §0 is where the explicit-invocation rule is single-sourced, so the reading has to sit beside it
// rather than only downstream — and it has to say that the "earlier turn" bullet above it still
// stands, since that bullet is what a reader would otherwise take the reading to have repealed.
const SKILL_MARKERS: ReadonlyArray<string> = [
	'A session cut inside a declared budget is not a new invocation** (joshuafolkken/kit#1714)',
	BUDGET_MARKER,
	SCOPE_MARKER,
]

// The resident copy is a trigger plus a pointer and nothing else. The scope marker is not
// decoration: without it a reader carries the reading into an `epicrun` or a `fullrun`, which is the
// one thing the decision does not license — so dropping that clause would let a run proceed wrongly
// rather than merely less well informed.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'**A session cut inside a declared budget is not a new invocation**',
	BUDGET_MARKER,
	'**`backlogrun` alone**',
	SCOPE_MARKER,
	'`.claude/skills/workflow-commands/backlogrun.md` → "The session cut is inside the invocation"',
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
	// joshuafolkken/kit#1722: the branch table has to carry the two ownership answers, or a run that
	// reads one has nothing telling it whether to stop, and the deciding falls back to a guess.
	BUSY_ROW,
	STANDING_ROW,
	'`--cut` is also what hands the record off, and it is the only thing that does.',
	'`--owner "$PPID"` is not decoration.',
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
	// joshuafolkken/kit#1722: the answer table and the two sentences that say what decides ownership.
	// A rewrite that dropped either would leave the string comparison as the documented behavior.
	BUSY_ROW,
	STANDING_ROW,
	'The record names the process spending the budget, and a second parent is refused against it.',
	'A session cut declares itself, so only a cut the run took is carried without anyone deciding.',
]

describe('the workflow skill states it beside the rule it qualifies', () => {
	const content = read_unwrapped(SKILL)

	it.each(SKILL_MARKERS)('says %s', (marker) => {
		expect(content).toContain(marker)
	})
})

describe('the resident document states the reading on a turn that loaded no skill', () => {
	const content = read_unwrapped(CANONICAL_DOC)

	it.each(AI_DOC_MARKERS)('says %s', (marker) => {
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
