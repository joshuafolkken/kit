import { read_unwrapped, WORKFLOW_PROMPT_DIRECTORY } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'

// joshuafolkken/kit#2201: a dispatched lane child's interactive ask must be refused one call before the
// stop notify #2034 wired the park to. What this suite pins is that correction as a documented rule:
// the delivery names the procedure rather than restating it, the single source carries the story, and
// the enumeration a reader reaches for names the trigger.
const TOPIC_FILE = '.claude/skills/workflow-commands/pre-gate-cut.md'
const DELIVERY = `${WORKFLOW_PROMPT_DIRECTORY}/rule-delivery.md`
const FIRING_SUITE = 'scripts/rules/lane-interactive-ask.test.ts'
const SECTION = '### The interactive ask is refused one call earlier'
const SHARED_EXTRACTOR = 'scripts/agent/interactive-ask.ts'

describe('the delivered text — what the refusal states', () => {
	const delivered = delivered_rules.LANE_INTERACTIVE_ASK_REASON

	// The pointer is where the procedure is; this rule was never resident in `CLAUDE.md`, because it
	// binds only after a lane child is already running.
	it('names the topic file rather than the resident document', () => {
		expect(delivered).toContain(TOPIC_FILE)
		expect(delivered).not.toContain('CLAUDE.md')
	})

	// **A refusal that named the ask but not what to record would be half a rule.** The park is
	// `needs-decision` plus the question, and the parent reads the label rather than a log line.
	it('hands over the park', () => {
		expect(delivered).toContain('needs-decision')
		expect(delivered).toContain("labels[]=needs-decision'")
		expect(delivered).toContain('backlogrun-park.md')
	})

	// It refuses every occurrence, never once per run — an interactive ask must never succeed.
	it('says it fires on every occurrence', () => {
		expect(delivered).toContain('every occurrence')
	})
})

describe(`${TOPIC_FILE} — the single source for the interactive-ask rule`, () => {
	const content = read_unwrapped(TOPIC_FILE)

	it.each([
		SECTION,
		'(joshuafolkken/kit#2201)',
		// The run the correction rests on, and the earlier rule it completes.
		'#2178',
		'joshuafolkken/kit#2034',
		'AskUserQuestion',
		// The backstop and the shared extractor.
		'pnpm josh run:ending',
		SHARED_EXTRACTOR,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${DELIVERY} — the enumeration names this rule and its silent turn`, () => {
	const content = read_unwrapped(DELIVERY)

	it.each([FIRING_SUITE, 'AskUserQuestion'])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The non-firing state that means the rule is kept, or the trigger has not been reached: a checkout
	// that is not a lane child, or a call that is not an interactive tool.
	it('says what a turn with no trigger means', () => {
		expect(content).toContain('レーンの子でない')
	})
})
