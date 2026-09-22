import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { decision_oracle } from './decision-oracle'
import { delivered_rules } from './delivered-rules'
import { delivered_rules_harness } from './delivered-rules-harness'
import { oracle_consulted } from './oracle-consulted'
import { oracle_firing } from './oracle-firing'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2324: the generic oracle-consulted rule refuses a governed action the run has not
// consulted the oracle for, and stands down once it has. This suite pins the generation (one row per
// firing oracle, id and reason from the registry), and the delivery end to end on the two firing points
// that claim a command no other row does — the package add and the release step.

const harness = delivered_rules_harness.create_harness('rule-guard-oracle-')
const { payload_of } = harness
const NOW_MS = 1_700_000_000_000
const { BRANCH } = time_transcript_fixture
const PKG_SCOUT = 'pkg:scout'
const RELEASE_SCOPE = 'release:scope'
const PKG_ADD_COMMAND = 'pnpm add lodash'
const FOLLOWUP_COMMAND = 'pnpm josh followup'

const RELEASE_ORACLE = decision_oracle.find_oracle(RELEASE_SCOPE)

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
	it('generates exactly the three firing oracles, in registry order', () => {
		expect(oracle_consulted.ROWS.map((row) => row.id)).toEqual([
			'oracle-consulted:release:scope',
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

describe('release:scope — refused on followup, stood down after the scope check', () => {
	it('refuses `pnpm josh followup` with no prior release:scope', () => {
		expect(rule_delivery(payload_of('rel-refuse', FOLLOWUP_COMMAND), NOW_MS)).toBe(
			reason_of(RELEASE_SCOPE),
		)
	})

	it('stands down once release:scope is on the tail', () => {
		const tail = consulted_tail('pnpm josh release:scope')

		expect(
			rule_delivery(payload_of('rel-ok', FOLLOWUP_COMMAND, 'Bash', tail), NOW_MS),
		).toBeUndefined()
	})

	it('is a real oracle whose command the row consults', () => {
		expect(RELEASE_ORACLE).toBeDefined()
	})
})
