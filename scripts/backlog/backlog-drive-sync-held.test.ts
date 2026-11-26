import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_hold_codes } from './backlog-hold-codes'

const { CONFIG, OFFERED, POLL_MS, harness, offer, state } = backlog_drive_fixture
const { MAIN_DIRTY_REASON, USAGE_LIMIT_REASON } = backlog_hold_codes
const THREE_PASSES = { ...CONFIG, window_ms: POLL_MS * 3 }

describe('backlog_drive — a main:sync a dirty primary checkout refused (joshuafolkken/kit#9034)', () => {
	it('launches nothing and records the hold as main-dirty, never ending the drive', async () => {
		const { ports, calls, holds } = harness({
			offers: [offer('run', [OFFERED])],
			sync_held: [true],
		})

		const end = await backlog_drive.run_loop(state(), THREE_PASSES, ports)

		expect(calls).not.toContain(`launch ${OFFERED}`)
		expect(holds).toContain(MAIN_DIRTY_REASON)
		expect(end.reason).toBe('window')
	})

	it('launches with no person once the hold is over', async () => {
		const { ports, calls } = harness({
			offers: [offer('run', [OFFERED]), offer('run', [OFFERED])],
			sync_held: [true, false],
		})

		await backlog_drive.run_loop(state(), { ...CONFIG, window_ms: CONFIG.offer_ms * 2 }, ports)

		expect(calls.slice(0, 3)).toStrictEqual(['offer', 'offer', `launch ${OFFERED}`])
	})

	it('records the usage limit first when both holds are in force', async () => {
		const { ports, holds } = harness({
			offers: [offer('run', [OFFERED])],
			usage_limited: [true],
			sync_held: [true],
		})

		await backlog_drive.run_loop(state(), THREE_PASSES, ports)

		expect(holds).toContain(USAGE_LIMIT_REASON)
		expect(holds).not.toContain(MAIN_DIRTY_REASON)
	})
})
