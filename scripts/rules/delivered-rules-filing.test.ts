import { delivered_rules_harness } from '#tools/rules/delivered-rules-harness'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import {
	BODY_READ_COMMAND,
	DIRECT_FILING_API_COMMAND,
	DIRECT_FILING_COMMAND,
	FILING_COMMAND,
	filings_tail,
} from './delivered-rules-fixture'

// joshuafolkken/kit#2119 / joshuafolkken/kit#2808: the delivery of the filing rules. A hand-built
// filing is refused by `direct-filing` on every occurrence. The filing cap, the WIP cap and the fold
// question are the command's own steps (joshuafolkken/kit#3423, joshuafolkken/kit#4750), so no row
// delivers them. The payload machinery is shared with `delivered-rules.test.ts` through
// `delivered-rules-harness.ts`.

const NOW_MS = 1_700_000_000_000
const A_LATER_MS = NOW_MS + 1
const ELEVEN_FILINGS = 11
const harness = delivered_rules_harness.create_harness('rule-guard-filing-')
const { payload_of } = harness

beforeEach(() => {
	process.env[delivered_rules.SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
})

describe('delivered_rules.delivery — a direct filing is refused and pointed at issue:file', () => {
	it.each([
		['gh-issue-create', DIRECT_FILING_COMMAND],
		['gh-api', DIRECT_FILING_API_COMMAND],
	])('refuses the %s spelling on every occurrence', (label, command) => {
		const payload = payload_of(`direct-${label}`, command)

		expect(delivered_rules.delivery(payload, NOW_MS)).toBe(delivered_rules.DIRECT_FILING_REASON)
		expect(delivered_rules.delivery(payload, A_LATER_MS)).toBe(delivered_rules.DIRECT_FILING_REASON)
	})

	it('names the command that files instead', () => {
		expect(delivered_rules.DIRECT_FILING_REASON).toContain('pnpm josh issue:file')
	})

	it('does not refuse the issue:file call itself', () => {
		const reason = delivered_rules.delivery(payload_of('through-command', FILING_COMMAND), NOW_MS)

		expect(reason).not.toBe(delivered_rules.DIRECT_FILING_REASON)
	})

	// A `#N` entry is handed an Issue that already exists: reading or updating it is not a filing.
	it.each([
		['a body read', BODY_READ_COMMAND],
		['a title PATCH', 'gh api -X PATCH repos/joshuafolkken/kit/issues/1319 -f title="x"'],
	])('does not refuse %s', (label, command) => {
		const reason = delivered_rules.delivery(payload_of(`not-a-filing-${label}`, command), NOW_MS)

		expect(reason).not.toBe(delivered_rules.DIRECT_FILING_REASON)
	})
})

describe('delivered_rules.delivery — an issue:file call reaches the command', () => {
	// joshuafolkken/kit#4750: the filing cap counts per originating work item on the event stream, as
	// `issue:file`'s own step, so no row counts the session transcript's filings against one ceiling.
	it('lets an eleventh filing on the transcript through to the command', () => {
		const tail = filings_tail(ELEVEN_FILINGS)

		expect(
			delivered_rules.delivery(payload_of('past-ten', FILING_COMMAND, 'Bash', tail), NOW_MS),
		).toBeUndefined()
	})

	// joshuafolkken/kit#3423: a second filing the run has not folded reaches the command, which asks
	// the fold question itself, rather than being refused first.
	it('lets a second filing through to the command', () => {
		const payload = payload_of('second-filing', FILING_COMMAND, 'Bash', filings_tail(1))

		expect(delivered_rules.delivery(payload, NOW_MS)).toBeUndefined()
	})
})
