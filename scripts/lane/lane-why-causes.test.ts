import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_why_causes } from './lane-why-causes'

// joshuafolkken/kit#6679: a lane's ship causes as keys matched to the open Issues that name them, the
// keys none names listed as unfiled.

const ISSUE = 6537
const AT = '2026-11-03T05:00:00.000Z'
const SONARQUBE = 'sonarqube'
const MAIN_MOVE = 'main move'
const BYTE_BUDGET = 'byte budget'
const SONAR_ISSUE = {
	number: 5085,
	title:
		'Check whether the SonarJasmin JS/TS taint engine gained incremental pull request analysis',
}
const BYTE_ISSUE = { number: 7001, title: 'Raise the byte budget of the ship docs' }

// #6537: the followup settled last on SonarQube after 157s.
const SONAR_WAIT: LedgerEntry = {
	kind: 'stage',
	at: AT,
	stage: 'ci-wait',
	elapsed_ms: 200_000,
	issue: ISSUE,
	last_check: 'SonarCloud Code Analysis',
	check_ms: { 'SonarCloud Code Analysis': 157_000 },
}

describe('lane_why_causes.keys_of', () => {
	it('keys the ledger longest check, a SonarQube check as sonarqube', () => {
		expect(lane_why_causes.keys_of([SONAR_WAIT], ISSUE, undefined)).toStrictEqual([SONARQUBE])
	})

	it('keys the failed checks, the main-move verdict and the byte budget the ship log names', () => {
		const log = [
			'PR checks failed (failed checks: Lint, SonarCloud; review requested changes).',
			'🔀 Not rerunning: main changed the failed tests since the branch point (a.ts); merge main first.',
			'✖ byte budget: docs/a.md is over its recorded size',
		].join('\n')

		expect(lane_why_causes.keys_of([SONAR_WAIT], ISSUE, log)).toStrictEqual([
			'lint',
			SONARQUBE,
			MAIN_MOVE,
			BYTE_BUDGET,
		])
	})

	it('keeps a parenthesised matrix check name whole and reads the checks after it', () => {
		const log =
			'PR checks failed (failed checks: Static Checks (lint), Unit Tests (3/6); review requested changes).\n' +
			'PR checks failed (failed checks: E2E (chromium)).'

		expect(lane_why_causes.keys_of([], ISSUE, log)).toStrictEqual([
			'static checks (lint)',
			'unit tests (3/6)',
			'e2e (chromium)',
		])
	})

	it('answers no key for a lane with no log and no ci-wait row', () => {
		expect(lane_why_causes.keys_of([SONAR_WAIT], ISSUE + 1, undefined)).toStrictEqual([])
	})
})

describe('lane_why_causes.open_cell', () => {
	it('binds the #6537 SonarQube key to #5085 by its title word', () => {
		const keys = lane_why_causes.keys_of([SONAR_WAIT], ISSUE, undefined)

		expect(lane_why_causes.open_cell(keys, [SONAR_ISSUE, BYTE_ISSUE])).toBe('#5085')
	})

	it('answers none with no named Issue and unread with no listing', () => {
		expect(lane_why_causes.open_cell(['lint'], [SONAR_ISSUE])).toBe('none')
		expect(lane_why_causes.open_cell(['lint'], undefined)).toBe('unread')
	})
})

describe('lane_why_causes.unfiled_cell', () => {
	it('lists the keys no open Issue names', () => {
		const keys = [SONARQUBE, BYTE_BUDGET, MAIN_MOVE]

		expect(lane_why_causes.unfiled_cell(keys, [SONAR_ISSUE, BYTE_ISSUE])).toBe(MAIN_MOVE)
		expect(lane_why_causes.unfiled_cell(keys, undefined)).toBe('unread')
	})
})
