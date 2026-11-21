import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_phases_steps } from './lane-phases-steps'

const { KIND, CI_WAIT_STAGE } = lane_ledger
const LANE = 8291
const OTHER_LANE = 9000
const FIRST_AT = '2026-11-20T05:50:04.466Z'
const LATER_AT = '2026-11-20T06:00:00.000Z'
const SELFCHECK = 'review:selfcheck'
const CHECK_RELATED = 'check:related'

function chain_stage(name: string, minutes: number, issue = LANE, at = LATER_AT): LedgerEntry {
	return {
		kind: KIND.CHAIN_STAGE,
		issue,
		result: 'passed',
		name,
		at,
		elapsed_ms: minutes * MS_PER_MINUTE,
	}
}

function stage(name: string, minutes: number, issue = LANE): LedgerEntry {
	return { kind: KIND.STAGE, at: LATER_AT, stage: name, elapsed_ms: minutes * MS_PER_MINUTE, issue }
}

function lines_of(entries: ReadonlyArray<LedgerEntry>, issues = [LANE]): Array<string> {
	return lane_phases_steps.text(entries, issues).split('\n')
}

describe('lane_phases_steps.text — run:chain stages', () => {
	it('prints each stage median and run count in first-seen order', () => {
		const entries = [
			chain_stage(SELFCHECK, 1),
			chain_stage(CHECK_RELATED, 2),
			chain_stage(SELFCHECK, 3),
			chain_stage(CHECK_RELATED, 4, OTHER_LANE),
		]

		expect(lines_of(entries).slice(0, 3)).toStrictEqual([
			'run:chain stages (median, samples):',
			'- review:selfcheck: 2.0 min median / 2 runs',
			'- check:related: 2.0 min median / 1 runs',
		])
	})

	it('names where the chain-stage records begin when the lanes have none', () => {
		const entries = [
			chain_stage('preflight', 1, OTHER_LANE, LATER_AT),
			chain_stage('ship', 1, OTHER_LANE, FIRST_AT),
		]

		expect(lines_of(entries)[0]).toBe(
			`run:chain stages: no chain-stage records for these lanes (first recorded ${FIRST_AT})`,
		)
	})

	it('says none were read when the ledger holds no chain-stage record', () => {
		expect(lines_of([])[0]).toBe(
			'run:chain stages: no chain-stage records for these lanes (none in the ledger read)',
		)
	})
})

describe('lane_phases_steps.text — josh ship steps', () => {
	it('prints each ship step median and run count, leaving other stage lines out', () => {
		const entries = [
			stage('pre-detach', 1),
			stage('gate', 2),
			stage('gate', 4),
			stage(CI_WAIT_STAGE, 9),
			stage('gate', 9, OTHER_LANE),
		]

		expect(lines_of(entries).slice(1)).toStrictEqual([
			'josh ship steps (median, samples):',
			'- pre-detach: 1.0 min median / 1 runs',
			'- gate: 3.0 min median / 2 runs',
		])
	})

	it('says so when the lanes have no ship step record', () => {
		expect(lines_of([stage(CI_WAIT_STAGE, 1)]).at(-1)).toBe(
			'josh ship steps: no ship step records for these lanes',
		)
	})
})
