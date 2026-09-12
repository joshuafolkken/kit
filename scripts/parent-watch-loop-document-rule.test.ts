import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1836: a `backlogrun` parent was measured at 24 API calls in one hour, averaging
// 356K of context each, with its own context flat across the hour — a saturated context re-read to
// write two lines. Two procedures were paying for it at once. The parent kept a 60-second clock of
// its own while `run:progress --wait` already ran in the background as the watcher that exists
// precisely so a parent does not spend a turn per heartbeat; and one merge was written as a chain of
// "Then …" steps, which a parent executed as three separate calls.
//
// The fix is procedural — the decision comment rejected every new mechanism — so what is asserted
// here is that the procedure says it. Each marker is one half a run used to get wrong.
const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'
const BACKLOGRUN = '.claude/skills/workflow-commands/backlogrun.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const DOCS = 'docs/josh-commands.md'

const SECTION_POINTER = 'The parent keeps no clock of its own'
const SECTION_HEADING = `### ${SECTION_POINTER} — the watcher's exit is the wake`

// The wake half: the parent starts nothing, the arithmetic that separates the watcher's share of the
// measured calls from its own, and the latency the trade buys — stated, because a cost left unwritten
// is one the next reader re-discovers by being surprised.
const WAKE_MARKERS: ReadonlyArray<string> = [
	SECTION_HEADING,
	'**So the parent starts no wait of its own.**',
	'**A `Bash` call that only sleeps is the spelling this forbids**',
	'**24 API calls in one hour, averaging 356K of context each**',
	'**At the default twenty-minute interval the watcher can account for at most three of those 24**',
	'**The cost is latency, and it is named rather than hidden.**',
	'**What is not dropped.**',
]

// The boundary the wake rule is only true inside. `--wait` ends at the first line it *prints*, and a
// state with nothing in flight produces no line — the loop declines and runs to its `--hours` bound
// instead. A parent that applied the wake rule there would wait an hour for a wake that never comes:
// `backlogrun`'s 30-minute idle watch would end having polled the backlog zero times, and the
// three-`retry` outage cap would take three hours. So the boundary is a table, not an inference.
const BOUNDARY_POINTER = 'The wake exists only while something is in flight'
const BOUNDARY_HEADING = `#### ${BOUNDARY_POINTER}`

const BOUNDARY_MARKERS: ReadonlyArray<string> = [
	BOUNDARY_HEADING,
	'**`--wait` ends at the first line it *prints*, and it prints only where there is something to',
	'**A declined watcher does not exit until its `--hours` bound, an hour by default.**',
	"| A child of this run's, in flight | **The watcher's exit.** Start no wait of your own |",
	'having polled the backlog **zero** times',
]

// The event half: one merge is one turn, and the acting turn issues the next event's reads so the
// steady state is one call per event rather than two.
const EVENT_MARKERS: ReadonlyArray<string> = [
	"**A merge is one event, and it is one turn of the parent's — never a chain of them.**",
	"**None of the reads a merge needs takes another's result as input**",
	'**The acting half is the next turn, and it is also one.**',
	'**In steady state that is one parent call per event, because the acting turn also issues the reads',
	'**A turn whose whole content is one read, or one two-line progress report, is the shape this',
]

describe(`${EPICRUN} — the wake rule is defined`, () => {
	const content = read_unwrapped(EPICRUN)

	it.each(WAKE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${EPICRUN} — the boundary of the wake rule is defined`, () => {
	const content = read_unwrapped(EPICRUN)

	it.each(BOUNDARY_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${EPICRUN} — the one-turn merge event is defined`, () => {
	const content = read_unwrapped(EPICRUN)

	it.each(EVENT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The two polling figures stay in the table — they are still the floor on how soon an ask may be
// repeated. What must not come back is the reading that made them a timer.
describe(`${EPICRUN} — the intervals are floors, not clocks`, () => {
	const content = read_unwrapped(EPICRUN)

	it('calls the polling interval a floor', () => {
		expect(content).toContain('**A floor between two asks, never a clock the parent sets.**')
	})

	it('no longer tells the loop to sleep the interval', () => {
		expect(content).not.toContain('sleep the polling interval and go back to step 1')
	})

	it('no longer tells the child poll to run on the interval', () => {
		expect(content).not.toContain('Poll at the polling interval; ask')
	})

	// The loop's `wait` row reaches both states — a child in flight, and a cross-repository publish
	// wait with nothing in flight — so it names which wake applies rather than assuming the first.
	it('gives the wait branch both states', () => {
		expect(content).toContain(
			"**With something of this run's own in flight, that happens on the wake the progress watcher's exit delivers**",
		)
		expect(content).toContain(
			'**With nothing in flight the watcher declines and never exits, so the parent keeps the interval**',
		)
	})
})

// `backlogrun` cites the rule and never restates it: a second copy is how the two come to say
// different things once one of them is edited.
describe(`${BACKLOGRUN} — the loop cites the rule`, () => {
	const content = read_unwrapped(BACKLOGRUN)

	it.each([
		"**Ask the command again on the wake the progress watcher's exit delivers**",
		SECTION_POINTER,
		BOUNDARY_POINTER,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The two rows that must NOT adopt the wake: a `retry` outage stops the watcher reading, and an
	// idle watch has nothing in flight for it to report. Both keep the interval the parent sleeps.
	it('keeps the interval on the retry row, and says why there is no wake', () => {
		expect(content).toContain('**this is one of the states with no watcher-delivered wake**')
		expect(content).toContain('Sleep the polling interval and **ask the command again**')
	})

	// Which interval applies and whether the parent keeps it as a clock are two tests, not one.
	// Collapsing them put a blocked backlog with nothing in flight on the 5-minute idle poll instead
	// of the 60-second interval, stretching the three-`retry` outage cap from ~3 minutes to ~15.
	it('keeps the interval choice and the clock question apart', () => {
		expect(content).toContain('**Two questions, and they are not the same test.**')
		expect(content).toContain('a blocked backlog with nothing in flight included')
	})
})

// background-commands.md is the single source of "a command that can take minutes is issued in the
// background" since joshuafolkken/kit#1873; the parent's wake is that rule at the batch's scale, which
// stayed resident in `SKILL.md` → §2h — so §2h names it and points at the single source.
describe(`${SKILL} — §2h names the batch-scale application`, () => {
	const content = read_unwrapped(SKILL)

	it.each([
		"**A parent waiting on its children is this same rule at the batch's scale.**",
		SECTION_POINTER,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// `backlog:budget`'s published answer table states the same wake rule to a reader who never opens the
// skill, so it carries the in-flight qualifier too — an unqualified row there is the defect this
// change's first round introduced, in the one place a person reads instead of a run.
describe(`${DOCS} — the budget watch row carries the qualifier`, () => {
	const content = read_unwrapped(DOCS)

	it.each([
		"**With something of this run's own in flight the sleep is the progress watcher's exit instead**",
		BOUNDARY_POINTER,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// Single-sourcing, asserted rather than assumed.
const NEVER_DEFINES: ReadonlyArray<string> = [BACKLOGRUN, SKILL, DOCS]

describe('the section is defined once', () => {
	it('lives in the epicrun procedure', () => {
		expect(read_unwrapped(EPICRUN)).toContain(SECTION_HEADING)
	})

	it.each(NEVER_DEFINES)('%s does not copy the heading', (path) => {
		expect(read_unwrapped(path)).not.toContain(SECTION_HEADING)
	})
})
