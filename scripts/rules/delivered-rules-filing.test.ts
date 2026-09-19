import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import {
	BODY_READ_COMMAND,
	FILING_API_COMMAND,
	filings_tail,
	scouted_tail,
} from './delivered-rules-fixture'
import { delivered_rules_harness } from './delivered-rules-harness'
import { filing_cap } from './filing-cap'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2119: the delivery of the two filing rules — the scout gate and the per-run cap.
// The payload machinery is shared with `delivered-rules.test.ts` through `delivered-rules-harness.ts`,
// so this suite holds only the firing and silence assertions for the rows this Issue added. **The WIP
// cap is listed first**, so every filing's first delivery is the WIP cap; these assertions read the
// deliveries after it, where the scout gate and the cap sit.

const NOW_MS = 1_700_000_000_000
const A_LATER_MS = NOW_MS + 1
const A_LATER_STILL_MS = NOW_MS + 2
const harness = delivered_rules_harness.create_harness('rule-guard-filing-')
const { payload_of } = harness

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
})

describe('rule_delivery — the scout gate at the call that files', () => {
	it('delivers the rule on a filing the run has not scouted', () => {
		const payload = payload_of('scout-missing', FILING_API_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(delivered_rules.ISSUE_SCOUT_REASON)
	})

	it('says nothing on a filing the run has already scouted', () => {
		const payload = payload_of('scouted', FILING_API_COMMAND, 'Bash', scouted_tail())

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBeUndefined()
	})

	// A `#N` entry is handed an Issue that already exists: reading or updating it is not a filing, so the
	// scout gate never fires on it.
	it.each([
		['a body read', BODY_READ_COMMAND],
		['a title PATCH', 'gh api -X PATCH repos/joshuafolkken/kit/issues/1319 -f title="x"'],
	])('does not deliver the scout rule on %s', (label, command) => {
		const reason = rule_delivery(payload_of(`not-a-filing-${label}`, command), NOW_MS)

		expect(reason).not.toBe(delivered_rules.ISSUE_SCOUT_REASON)
	})

	it('delivers once per run rather than once per call', () => {
		const payload = payload_of('scout-repeat', FILING_API_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(delivered_rules.ISSUE_SCOUT_REASON)
		expect(rule_delivery(payload, A_LATER_STILL_MS)).toBeUndefined()
	})
})

// Each fixture tail carries a scout so the scout gate stands down, and the first delivery consumes the
// once-per-run WIP cap — the cap itself is read from the deliveries after that.
describe('rule_delivery — the filing cap at the call past the ceiling', () => {
	it('says nothing while the run is under the cap', () => {
		const tail = filings_tail(filing_cap.FILING_CAP - 1)
		const payload = payload_of('cap-under', FILING_API_COMMAND, 'Bash', tail)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBeUndefined()
	})

	// **It fires on every filing past the cap, not once per run** — a second call is refused too.
	it('refuses every filing once the cap is reached', () => {
		const payload = payload_of(
			'cap-over',
			FILING_API_COMMAND,
			'Bash',
			filings_tail(filing_cap.FILING_CAP),
		)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(delivered_rules.FILING_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_STILL_MS)).toBe(delivered_rules.FILING_CAP_REASON)
	})

	// A guard-refused filing did not create an Issue, so it does not count: ten filings with one refused
	// is nine, and the tenth is allowed.
	it('does not count a guard-refused filing toward the cap', () => {
		const tail = filings_tail(filing_cap.FILING_CAP, 1)
		const payload = payload_of('cap-refused', FILING_API_COMMAND, 'Bash', tail)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBeUndefined()
	})
})
