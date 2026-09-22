import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { decision_oracle } from './decision-oracle'
import { delivered_rules } from './delivered-rules'
import { FILING_API_COMMAND, filings_tail } from './delivered-rules-fixture'
import { delivered_rules_harness } from './delivered-rules-harness'
import { oracle_consulted } from './oracle-consulted'
import { oracle_firing } from './oracle-firing'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2324: the generic oracle-consulted rule refuses a governed action the run has not
// consulted the oracle for, and stands down once it has. This suite pins the generation (one row per
// firing oracle, id and reason from the registry), and the delivery end to end on both firing points —
// the package add, which claims a command no other row does, and the Issue filing, which overlaps the
// filing rows and so delivers only after they have stood down (joshuafolkken/kit#2334).

const harness = delivered_rules_harness.create_harness('rule-guard-oracle-')
const { payload_of } = harness
const NOW_MS = 1_700_000_000_000
const A_LATER_MS = NOW_MS + 1
const { BRANCH } = time_transcript_fixture
const PKG_SCOUT = 'pkg:scout'
const ISSUE_LINT = 'issue:lint'
const PKG_ADD_COMMAND = 'pnpm add lodash'

const ISSUE_LINT_ORACLE = decision_oracle.find_oracle(ISSUE_LINT)

// The generated reason for a firing oracle, resolved from the registry so the expectation is the
// generated text rather than a second copy of it.
function reason_of(name: string): string {
	const oracle = decision_oracle.find_oracle(name)
	const firing_point = oracle_firing.FIRING.get(name)

	if (oracle === undefined || firing_point === undefined) {
		throw new Error(`no firing oracle ${name}`)
	}

	return oracle_consulted.reason_for(oracle, firing_point)
}

// A transcript tail carrying a prior `pnpm josh <command>` call, so the governed action has consulted it.
function consulted_tail(command: string): string {
	return time_transcript_fixture.josh_call_line(1, BRANCH, command)
}

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
})

describe('ROWS — one generated row per firing oracle', () => {
	it('generates exactly the two firing oracles, in registry order', () => {
		expect(oracle_consulted.ROWS.map((row) => row.id)).toEqual([
			'oracle-consulted:pkg:scout',
			'oracle-consulted:issue:lint',
		])
	})

	it('every generated row is also in DELIVERED_RULES', () => {
		const ids = new Set(delivered_rules.DELIVERED_RULES.map((rule) => rule.id))

		for (const row of oracle_consulted.ROWS) {
			expect(ids.has(row.id)).toBe(true)
		}
	})
})

// The registry fields the generated reason must carry, so the assertion reads them from the oracle
// rather than restating them — a hand-written refusal is exactly what this row exists to avoid.
const PKG_ORACLE = decision_oracle.find_oracle(PKG_SCOUT)
const PKG_MARKERS = [
	PKG_ORACLE?.decision.toLowerCase() ?? '',
	'pnpm josh pkg:scout <keywords>',
	(PKG_ORACLE?.vocabulary ?? []).join(' | '),
	PKG_ORACLE?.single_source ?? '',
	'once per run',
]

describe('reason_for — assembled from the registry, not hand-written', () => {
	it.each(PKG_MARKERS)('carries %j', (marker) => {
		expect(reason_of(PKG_SCOUT)).toContain(marker)
	})
})

describe('pkg:scout — refused on a package add, stood down after the scout', () => {
	it('refuses `pnpm add` with no prior scout', () => {
		expect(rule_delivery(payload_of('pkg-refuse', PKG_ADD_COMMAND), NOW_MS)).toBe(
			reason_of(PKG_SCOUT),
		)
	})

	it('stands down once the scout is on the tail', () => {
		const tail = consulted_tail('pnpm josh pkg:scout lodash')

		expect(
			rule_delivery(payload_of('pkg-ok', PKG_ADD_COMMAND, 'Bash', tail), NOW_MS),
		).toBeUndefined()
	})

	it('is silent on a bare install', () => {
		expect(rule_delivery(payload_of('pkg-install', 'pnpm install'), NOW_MS)).toBeUndefined()
	})
})

describe('issue:lint — refused on a filing, after the filing rows, stood down after the lint', () => {
	// A scouted tail with no prior filing stands the filing rows down; the WIP cap is spent by the first
	// delivery, so the oracle-consulted row is what is left on the reissue.
	it('refuses a filing with no prior issue:lint, once the filing rows have stood down', () => {
		const payload = payload_of('lint-refuse', FILING_API_COMMAND, 'Bash', filings_tail(0))

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBe(reason_of(ISSUE_LINT))
	})

	it('stands down once issue:lint is on the tail', () => {
		const tail = [filings_tail(0), consulted_tail('pnpm josh issue:lint x.md')].join('\n')
		const payload = payload_of('lint-ok', FILING_API_COMMAND, 'Bash', tail)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, A_LATER_MS)).toBeUndefined()
	})

	it('is a real oracle whose command the row consults', () => {
		expect(ISSUE_LINT_ORACLE).toBeDefined()
	})
})
