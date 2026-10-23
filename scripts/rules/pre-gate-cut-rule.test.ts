import { read_unwrapped, RULE_DELIVERY_RATIONALE } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_list } from './rule-list'

// joshuafolkken/kit#1864: the pre-gate cut existed, was documented, was read three to five times per
// run — and was taken **0 times in 6 lane children**. What this suite pins is the correction: that the
// rule is now *delivered* at the call it binds on, that its procedure stays in one place, and that
// both documents a reader might reach for name the trigger.
//
// **The measurement is the load-bearing half.** Without the 0-of-6 figure the row reads as a
// precaution, and a precaution is the first thing dropped when the enumeration is next trimmed.
const TOPIC_FILE = '.claude/skills/workflow-commands/pre-gate-cut.md'
const RATIONALE_FILE = 'docs/maintainers/pre-gate-cut-rationale.md'
const COMMANDS_DOCUMENT = 'docs/josh-commands-automation.md'
const RUN_COMMANDS_DOCUMENT = 'docs/josh-commands-run.md'
const DISPATCH_MARK = '`JOSH_LANE_CHILD`'
const FIRING_SUITE = 'scripts/rules/pre-gate-cut.test.ts'
// Named once: the enumeration, the topic file and the command reference have to agree on both
// commands, and a string kept correct in one of three places is not kept.
const GUARD_COMMAND = 'pnpm josh pretool:guard'
const ROW_REFERENCE = '`pre-gate-cut` row of `pnpm josh rule:list`'
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

	// **The dispatch mark is what fires the refusal, so a person sees none** (joshuafolkken/kit#1904).
	// The refusal names the lane it fired in; the topic file states that a person carries no mark.
	it('states that it fired in a dispatched lane, and the topic file says a person sees none', () => {
		expect(delivered).toContain('a lane dispatched for this issue')
		expect(read_unwrapped(TOPIC_FILE)).toContain('An interactive `fullrun` carries no mark')
	})
})

describe(`${RATIONALE_FILE} — the measurement behind the rule`, () => {
	const content = read_unwrapped(RATIONALE_FILE)

	// The figure the enforcement rests on, kept off the read path beside the procedure it explains.
	it.each(['the step fired exactly never', 'the cut was taken **0 times**'])(
		'states %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)
})

describe(`${TOPIC_FILE} — the single source for the rule`, () => {
	const content = read_unwrapped(TOPIC_FILE)

	it.each([
		'### The gate refuses until the cut has been taken',
		ROW_REFERENCE,
		'**It fires for a marked child and nowhere else**',
		DISPATCH_MARK,
		RUN_COMMANDS_DOCUMENT,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// joshuafolkken/kit#4129 moved how the guard and the mark work out of the skill, which keeps the
// action alone, into the command reference.
describe(`${RUN_COMMANDS_DOCUMENT} — how the guard and the mark work`, () => {
	const content = read_unwrapped(RUN_COMMANDS_DOCUMENT)

	// **The two silent states are what make the row worth having rather than worth removing.** A rule
	// that fired in an ordinary checkout would refuse the gate of every interactive run, which this
	// repository treats as worse than no rule at all.
	it.each([
		'is silent once the cut is carried',
		'once per run',
		// The mark is what makes the guard's half mechanical, so the guard and `run:cut` need not agree.
		'need not agree byte for byte',
	])('states the boundary %j', (marker) => {
		expect(content).toContain(marker)
	})

	// **The mark's single-source documentation** (joshuafolkken/kit#1904): its name, meaning and
	// lifetime live here and in the one module, so a reader learns what fires the rule in one place.
	it.each(['**The dispatch mark:**', DISPATCH_MARK, 'scripts/lane/lane-child-marker.ts'])(
		'states the dispatch mark %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)

	// The distinction the measurement turned on: four of the six children issued the asking spelling
	// and went straight to the gate, so counting it would have credited exactly the failing runs.
	it('records that the asking spellings are not the cut', () => {
		expect(content).toContain('`--resume`, `--end` and `--json` do not count as taking the cut')
	})
})

describe(`pnpm josh rule:list — the enumeration names this rule and its silent turn`, () => {
	const content = rule_list.render()

	it.each([TOPIC_FILE, GUARD_COMMAND])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('leaves the firing suite to the rationale', () => {
		expect(read_unwrapped(RULE_DELIVERY_RATIONALE)).toContain(FIRING_SUITE)
	})

	// Every row of that table has to have a non-firing state that means the rule is being kept, or the
	// trigger has not been identified. This one's is a checkout that is not a lane, or a cut already
	// taken.
	it('says what a turn with no trigger means', () => {
		expect(content).toContain('outside a lane, no marker (a person in the lane), or already cut')
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
