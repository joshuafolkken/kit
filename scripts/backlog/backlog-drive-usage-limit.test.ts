import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#4745: no lane opens while a Claude usage limit that stopped a child has yet to
// reset, and the held offer launches once it has.

const { CONFIG, OFFERED, POLL_MS, harness, offer, state } = backlog_drive_fixture
const { USAGE_LIMIT_REASON } = backlog_drive
const THREE_PASSES = { ...CONFIG, window_ms: POLL_MS * 3 }

describe('backlog_drive.run_loop — a usage-limit hold', () => {
	it('launches nothing before the reset and records the hold as usage-limit', async () => {
		const { ports, calls, holds } = harness({
			offers: [offer('run', [OFFERED])],
			usage_limited: [true],
		})

		await backlog_drive.run_loop(state(), THREE_PASSES, ports)

		expect(calls).not.toContain(`launch ${OFFERED}`)
		expect(holds).toContain(USAGE_LIMIT_REASON)
	})

	it('launches the offer once the limit has reset', async () => {
		const offers = [offer('run', [OFFERED]), offer('run', [OFFERED])]
		const { ports, calls } = harness({ offers, usage_limited: [true, false] })

		await backlog_drive.run_loop(state(), { ...CONFIG, window_ms: CONFIG.offer_ms * 2 }, ports)

		expect(calls.slice(0, 3)).toStrictEqual(['offer', 'offer', `launch ${OFFERED}`])
	})
})
