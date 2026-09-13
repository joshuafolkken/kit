import { delivered_rules } from '#scripts/rules/delivered-rules'
import { describe, expect, it } from 'vitest'
import { read_unwrapped, WORKFLOW_PROMPT_DIRECTORY } from './ai-document-fixture'

// joshuafolkken/kit#1864: the pre-gate cut existed, was documented, was read three to five times per
// run — and was taken **0 times in 6 lane children**. What this suite pins is the correction: that the
// rule is now *delivered* at the call it binds on, that its procedure stays in one place, and that
// both documents a reader might reach for name the trigger.
//
// **The measurement is the load-bearing half.** Without the 0-of-6 figure the row reads as a
// precaution, and a precaution is the first thing dropped when the enumeration is next trimmed.
const TOPIC_FILE = '.claude/skills/workflow-commands/pre-gate-cut.md'
const DELIVERY = `${WORKFLOW_PROMPT_DIRECTORY}/rule-delivery.md`
const COMMANDS_DOCUMENT = 'docs/josh-commands.md'
const FIRING_SUITE = 'scripts/rules/pre-gate-cut.test.ts'
// Named once: the enumeration, the topic file and the command reference have to agree on both
// commands, and a string kept correct in one of three places is not kept.
const GUARD_COMMAND = 'pnpm josh rule:guard'
const CUT_COMMAND = 'pnpm josh run:cut <N>'

describe('the delivered text — what the refusal states', () => {
	const delivered = delivered_rules.PRE_GATE_CUT_REASON

	// The pointer is where the procedure is, and this rule never was resident in `CLAUDE.md` to point
	// back at — it binds only after a lane child is already running.
	it('names the topic file rather than the resident document', () => {
		expect(delivered).toContain(TOPIC_FILE)
		expect(delivered).not.toContain('CLAUDE.md')
	})

	// **A refusal that named the command but not what its answer obliges would be half a rule.** `cut`
	// is the only verdict that ends the turn, and a run that guessed wrong either abandons the work or
	// races a second process against it.
	it('hands over the command and what its verdicts oblige', () => {
		expect(delivered).toContain(CUT_COMMAND)
		expect(delivered).toContain('end the turn immediately')
	})

	// **The dispatch mark is what fires the refusal now, so a person sees none** (joshuafolkken/kit#1904).
	// The old text warned a person on the firing side not to cut; the mark takes them off it, so the
	// refusal states why it fired rather than telling someone to ignore it.
	it('states that the dispatch mark fired it, and a person carries none', () => {
		expect(delivered).toContain('the dispatch mark names this lane')
		expect(delivered).toContain('carries no mark and sees no refusal')
	})
})

describe(`${TOPIC_FILE} — the single source for the rule and the measurement behind it`, () => {
	const content = read_unwrapped(TOPIC_FILE)

	it.each([
		'### The gate refuses until the cut has been taken (joshuafolkken/kit#1864)',
		'**This step was carried as prose and fired exactly never.**',
		// The figure the enforcement rests on.
		'the cut was taken **0 times**',
		GUARD_COMMAND,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// **The two silent states are what make the row worth having rather than worth removing.** A rule
	// that fired in an ordinary checkout would refuse the gate of every interactive run, which this
	// repository treats as worse than no rule at all.
	it.each([
		'**It fires for a marked child and nowhere else**',
		'**It is silent once the cut is carried**',
		'**It fires once per run.**',
		// The mark is what makes the guard's half mechanical, so the guard and `run:cut` need not agree.
		'the guard and the command need not agree byte for byte',
	])('states the boundary %j', (marker) => {
		expect(content).toContain(marker)
	})

	// **The mark's single-source documentation** (joshuafolkken/kit#1904): its name, meaning and
	// lifetime live here and in the one module, so a reader learns what fires the rule in one place.
	it.each([
		'### The dispatch mark',
		'`JOSH_LANE_CHILD`',
		'scripts/lane/lane-child-marker.ts',
		'documented here and nowhere else',
	])('states the dispatch mark %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The distinction the measurement turned on: four of the six children issued the asking spelling
	// and went straight to the gate, so counting it would have credited exactly the failing runs.
	it('records that the asking spellings are not the cut', () => {
		expect(content).toContain('`--resume`, `--end` and `--json` do not count as taking the cut')
	})
})

describe(`${DELIVERY} — the enumeration names this rule and its silent turn`, () => {
	const content = read_unwrapped(DELIVERY)

	it.each([TOPIC_FILE, GUARD_COMMAND, FIRING_SUITE])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// Every row of that table has to have a non-firing state that means the rule is being kept, or the
	// trigger has not been identified. This one's is a checkout that is not a lane, or a cut already
	// taken.
	it('says what a turn with no trigger means', () => {
		expect(content).toContain(
			'レーン以外の checkout に居る、目印が無い（レーン内の人）、または既に cut 済み',
		)
	})
})

describe(`${COMMANDS_DOCUMENT} — the command reference names the trigger`, () => {
	const content = read_unwrapped(COMMANDS_DOCUMENT)

	it.each([
		'**The pre-gate cut row**',
		// Both halves of the trigger, neither of which is readable from the command string.
		'has not yet taken its cut',
		'0 times in 6 lane children',
		TOPIC_FILE,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
