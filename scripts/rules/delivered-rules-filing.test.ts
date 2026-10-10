import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import {
	BODY_READ_COMMAND,
	DIRECT_FILING_API_COMMAND,
	DIRECT_FILING_COMMAND,
	FILING_COMMAND,
	filings_tail,
} from './delivered-rules-fixture'
import { delivered_rules_harness } from './delivered-rules-harness'
import { filing_cap } from './filing-cap'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2119 / joshuafolkken/kit#2808: the delivery of the filing rules. A hand-built
// filing is refused by `direct-filing` on every occurrence; the per-run cap triggers on the
// `josh issue:file` call. The WIP cap and the fold question are the command's own steps
// (joshuafolkken/kit#3423), so no row delivers them. The payload machinery is shared with
// `delivered-rules.test.ts` through `delivered-rules-harness.ts`.

const NOW_MS = 1_700_000_000_000
const A_LATER_MS = NOW_MS + 1
const harness = delivered_rules_harness.create_harness('rule-guard-filing-')
const { payload_of } = harness

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
})

describe('rule_delivery — a direct filing is refused and pointed at issue:file', () => {
	it.each([
		['gh-issue-create', DIRECT_FILING_COMMAND],
		['gh-api', DIRECT_FILING_API_COMMAND],
	])('refuses the %s spelling on every occurrence', (label, command) => {
		const payload = payload_of(`direct-${label}`, command)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.DIRECT_FILING_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(delivered_rules.DIRECT_FILING_REASON)
	})

	it('names the command that files instead', () => {
		expect(delivered_rules.DIRECT_FILING_REASON).toContain('pnpm josh issue:file')
	})

	it('does not refuse the issue:file call itself', () => {
		const reason = rule_delivery(payload_of('through-command', FILING_COMMAND), NOW_MS)

		expect(reason).not.toBe(delivered_rules.DIRECT_FILING_REASON)
	})

	// A `#N` entry is handed an Issue that already exists: reading or updating it is not a filing.
	it.each([
		['a body read', BODY_READ_COMMAND],
		['a title PATCH', 'gh api -X PATCH repos/joshuafolkken/kit/issues/1319 -f title="x"'],
	])('does not refuse %s', (label, command) => {
		const reason = rule_delivery(payload_of(`not-a-filing-${label}`, command), NOW_MS)

		expect(reason).not.toBe(delivered_rules.DIRECT_FILING_REASON)
	})
})

describe('rule_delivery — the filing cap at the call past the ceiling', () => {
	it('says nothing while the run is under the cap', () => {
		const tail = filings_tail(filing_cap.FILING_CAP - 1)

		expect(
			rule_delivery(payload_of('cap-under', FILING_COMMAND, 'Bash', tail), NOW_MS),
		).toBeUndefined()
	})

	// **It fires on every filing past the cap, not once per run** — a second call is refused too.
	it('refuses every filing once the cap is reached', () => {
		const tail = filings_tail(filing_cap.FILING_CAP)
		const payload = payload_of('cap-over', FILING_COMMAND, 'Bash', tail)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.FILING_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(delivered_rules.FILING_CAP_REASON)
	})

	// A failed filing did not create an Issue, so it does not count: ten filings with one failed is
	// nine, and the tenth is allowed.
	it('does not count a failed filing toward the cap', () => {
		const tail = filings_tail(filing_cap.FILING_CAP, 1)

		expect(
			rule_delivery(payload_of('cap-refused', FILING_COMMAND, 'Bash', tail), NOW_MS),
		).toBeUndefined()
	})

	// joshuafolkken/kit#3423: a second filing the run has not folded reaches the command, which asks
	// the fold question itself, rather than being refused first.
	it('lets a second filing through to the command', () => {
		const payload = payload_of('second-filing', FILING_COMMAND, 'Bash', filings_tail(1))

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})
})
