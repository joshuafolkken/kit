import type { RunCarry } from '#scripts/run/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_retrospective } from './backlog-drive-retrospective'

const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-09-23T23:00:00.000Z',
	merged: 3,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

describe('backlog_drive_retrospective.is_owed — the JOSH_RETROSPECTIVE switch', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('owes no retrospective at a drain when the switch is unset', () => {
		vi.stubEnv('JOSH_RETROSPECTIVE', undefined)

		expect(backlog_drive_retrospective.is_owed(CARRY)).toBe(false)
	})

	it('owes the retrospective when the switch is on and it has not run', () => {
		vi.stubEnv('JOSH_RETROSPECTIVE', 'on')

		expect(backlog_drive_retrospective.is_owed(CARRY)).toBe(true)
	})

	it('owes none once the retrospective has run', () => {
		vi.stubEnv('JOSH_RETROSPECTIVE', 'on')

		expect(backlog_drive_retrospective.is_owed({ ...CARRY, retrospective: true })).toBe(false)
	})
})
