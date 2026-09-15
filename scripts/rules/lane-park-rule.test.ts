import { read_unwrapped, WORKFLOW_PROMPT_DIRECTORY } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'

// joshuafolkken/kit#2034: a dispatched lane child that stopped for a decision left no question on the
// Issue — twice in one run. What this suite pins is the correction: the rule is delivered at the stop
// notify it binds on, its procedure stays in one place, and the enumeration a reader reaches for names
// the trigger.
const TOPIC_FILE = '.claude/skills/workflow-commands/pre-gate-cut.md'
const DELIVERY = `${WORKFLOW_PROMPT_DIRECTORY}/rule-delivery.md`
const FIRING_SUITE = 'scripts/rules/lane-park.test.ts'
const GUARD_COMMAND = 'pnpm josh rule:guard'
const STOP_NOTIFY = 'pnpm josh notify --task-type confirmation'
const PARK_SOURCE = 'backlogrun-park.md'

describe('the delivered text — what the refusal states', () => {
	const delivered = delivered_rules.LANE_PARK_REASON

	// The pointer is where the procedure is; this rule was never resident in `CLAUDE.md`, because it
	// binds only after a lane child is already running.
	it('names the topic file rather than the resident document', () => {
		expect(delivered).toContain(TOPIC_FILE)
		expect(delivered).not.toContain('CLAUDE.md')
	})

	// **A refusal that named the stop but not what to record would be half a rule.** The park is
	// `needs-decision` plus the question, and the parent reads the label rather than a log line.
	it('hands over the park and names the settled-label stops it does not touch', () => {
		expect(delivered).toContain('needs-decision')
		expect(delivered).toContain('labels[]=needs-decision')
		expect(delivered).toContain('needs-human-review')
	})

	it('says the delivery is once per run', () => {
		expect(delivered).toContain('once per run')
	})
})

describe(`${TOPIC_FILE} — the single source for the rule and the measurement behind it`, () => {
	const content = read_unwrapped(TOPIC_FILE)

	it.each([
		'## A lane child records its park before it stops',
		'(joshuafolkken/kit#2034)',
		// The two runs the enforcement rests on.
		'#2012',
		'#2011',
		STOP_NOTIFY,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The silent states are what make the row worth having: a rule that spoke for a person working in a
	// lane would refuse every stop they make.
	it.each([
		'It fires for a marked child and nowhere else',
		'**It fires once per run.**',
		GUARD_COMMAND,
		PARK_SOURCE,
	])('states the boundary %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${DELIVERY} — the enumeration names this rule and its silent turn`, () => {
	const content = read_unwrapped(DELIVERY)

	it.each([TOPIC_FILE, GUARD_COMMAND, FIRING_SUITE])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// Every row of the table has a non-firing state that means the rule is kept, or the trigger has not
	// been identified. This one's is a checkout that is not a lane child, or a call that is not a stop.
	it('says what a turn with no trigger means', () => {
		expect(content).toContain('レーンの子でない')
	})
})
