import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
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
// A real, classified body the filing cases lint and file, so `issue-bug-label` stands down: an
// unreadable linted file is refused (joshuafolkken/kit#2807).
const work = mkdtempSync(path.join(tmpdir(), 'rule-guard-filing-body-'))
const linted_body_path = path.join(work, 'body.md')
const LINTED_FILING = `gh api repos/joshuafolkken/kit/issues -f title=x -F body=@${linted_body_path}`

writeFileSync(linted_body_path, '## 背景\n\n- 種別: 非不具合\n')

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
	rmSync(work, { recursive: true, force: true })
})

// A `pnpm josh issue:fold` call appended to a tail, so the fold gate stands down for a run that has
// already folded. The cap suite uses it to isolate `filing-cap` from the fold gate, exactly as the
// scout in every fixture tail isolates it from `issue-scout`.
function with_fold(tail: string): string {
	return [
		tail,
		time_transcript_fixture.josh_call_line(
			20,
			time_transcript_fixture.BRANCH,
			'pnpm josh issue:fold "a" "b"',
		),
	].join('\n')
}

// A scouted tail carrying one prior filing and then a fold call.
function folded_tail(): string {
	return with_fold(filings_tail(1))
}

// A `pnpm josh issue:lint` call, so the `issue:lint` oracle-consulted row stands down for a run that
// has linted (joshuafolkken/kit#2324) — the newest filing row, isolated the same way the scout and the
// fold are. `with_lint` appends it to a tail; `lint_only` is the whole tail for a case that needs the
// scout gate to still fire (no scout on the tail) while the oracle row stands down. The linted body is
// the real file `LINTED_FILING` files, so `issue-bug-label` stands down too.
function with_lint(tail: string): string {
	return [
		tail,
		time_transcript_fixture.josh_call_line(
			21,
			time_transcript_fixture.BRANCH,
			`pnpm josh issue:lint ${linted_body_path}`,
		),
	].join('\n')
}

function lint_only(): string {
	return with_lint('')
}

describe('rule_delivery — the scout gate at the call that files', () => {
	it('delivers the rule on a filing the run has not scouted', () => {
		const payload = payload_of('scout-missing', FILING_API_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(delivered_rules.ISSUE_SCOUT_REASON)
	})

	it('says nothing on a filing the run has already scouted', () => {
		const payload = payload_of('scouted', LINTED_FILING, 'Bash', with_lint(scouted_tail()))

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

	// Once per run let the reissue file without a scout (joshuafolkken/kit#2807).
	it('keeps refusing the reissue until the scout runs', () => {
		const payload = payload_of('scout-repeat', LINTED_FILING, 'Bash', lint_only())

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(delivered_rules.ISSUE_SCOUT_REASON)
		expect(rule_delivery(payload, A_LATER_STILL_MS)).toBe(delivered_rules.ISSUE_SCOUT_REASON)
	})
})

// Each fixture tail carries a scout so the scout gate stands down, and the first delivery consumes the
// once-per-run WIP cap — the cap itself is read from the deliveries after that.
describe('rule_delivery — the filing cap at the call past the ceiling', () => {
	it('says nothing while the run is under the cap', () => {
		const tail = with_lint(with_fold(filings_tail(filing_cap.FILING_CAP - 1)))
		const payload = payload_of('cap-under', LINTED_FILING, 'Bash', tail)

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
		const tail = with_lint(with_fold(filings_tail(filing_cap.FILING_CAP, 1)))
		const payload = payload_of('cap-refused', LINTED_FILING, 'Bash', tail)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBeUndefined()
	})
})

// Each tail carries the scout so `issue-scout` stands down, and the WIP cap is consumed by the first
// delivery — the fold gate itself is read from the deliveries after that.
describe('rule_delivery — the fold gate at the second filing', () => {
	it('says nothing on the first filing, with nothing to fold with', () => {
		const payload = payload_of('fold-first', LINTED_FILING, 'Bash', with_lint(filings_tail(0)))

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBeUndefined()
	})

	it('delivers on a second filing the run has not folded', () => {
		const payload = payload_of('fold-second', FILING_API_COMMAND, 'Bash', filings_tail(1))

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(delivered_rules.ISSUE_FOLD_REASON)
	})

	it('says nothing on a second filing the run has already folded', () => {
		const payload = payload_of('fold-done', LINTED_FILING, 'Bash', with_lint(folded_tail()))

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBeUndefined()
	})
})
