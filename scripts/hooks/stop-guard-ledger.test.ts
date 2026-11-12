import { stop_rules } from '#scripts/rules/stop-rules'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_ledger } from './hook-ledger'
import { stop_actions } from './stop-actions'
import { write_stop_decision } from './stop-guard'
import { stop_guard_fixture } from './stop-guard-fixture'

// joshuafolkken/kit#6587: the stop hook hands the ledger the reason its written envelope blocks with —
// a stop held by a failed action as much as one refused outright.

const { UNREAD_TRANSCRIPT, quiet_world } = stop_guard_fixture
const PAYLOAD = JSON.stringify({ transcript_path: UNREAD_TRANSCRIPT })
const HOOK = 'stop-guard'

afterEach(() => {
	vi.restoreAllMocks()
})

async function recorded_on(envelope: string | undefined): Promise<Array<unknown>> {
	quiet_world()
	vi.spyOn(stop_actions, 'envelope_of').mockResolvedValue(envelope)
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const record = vi.spyOn(hook_ledger, 'record_reason').mockResolvedValue(undefined)

	await write_stop_decision(PAYLOAD)

	return record.mock.calls.map((call) => call.slice(0, 2))
}

describe('write_stop_decision — the hook ledger', () => {
	it('records the reason a stop held by a failed notify blocks with', async () => {
		const held = stop_rules.block_envelope(stop_rules.STOP_NOTIFY_REASON, 'en')

		expect(await recorded_on(held)).toEqual([
			[HOOK, expect.stringContaining(stop_rules.STOP_NOTIFY_REASON)],
		])
	})

	it('records no reason for a notice that holds nothing', async () => {
		expect(await recorded_on(stop_rules.notice_envelope('sent'))).toEqual([[HOOK, undefined]])
	})

	it('records nothing for an ordinary stop that writes nothing', async () => {
		expect(await recorded_on(undefined)).toEqual([])
	})
})
