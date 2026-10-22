import type { RunCarry } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { backlog_drive, type OfferRead } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_restore } from './backlog-drive-restore'

// A `--only` run ends once its named issues are done, even with a lane an earlier invocation dispatched
// for another issue still open (joshuafolkken/kit#4282).

const { CONFIG, harness, state } = backlog_drive_fixture
const NAMED = '4263'
const NAMED_TOO = '4262'
// A lane an earlier invocation dispatched, which this run does not name and which never finishes.
const FOREIGN = '4211'
const WINDOW_MS = 600_000
const BOUNDED = { ...CONFIG, window_ms: WINDOW_MS }

const ONLY_CARRY: RunCarry = {
	invocation: `backlogrun #${NAMED} #${NAMED_TOO} --only`,
	started_at: '2026-10-20T04:39:10.574Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const DRAINING_CARRY: RunCarry = { ...ONLY_CARRY, invocation: `backlogrun #${NAMED} #${NAMED_TOO}` }

function launched(pos: number, issue: string): RunEvent {
	return { pos, kind: 'child-launch', text: `#${issue} dispatched`, at: ONLY_CARRY.started_at }
}

// The lanes the driver starts with: the named two this invocation launched, and the foreign one an
// earlier invocation left dispatched.
function seeded(carry: RunCarry, is_only: boolean): ReadonlyArray<string> {
	const events = [launched(1, NAMED), launched(2, NAMED_TOO)]
	const dispatched = backlog_drive_named.own_carried(carry, [FOREIGN], is_only)

	return backlog_drive_restore.restore([FOREIGN, NAMED, NAMED_TOO], events, [], dispatched)
}

// What the named offer answers once both named issues are booked done.
function only_finish(): OfferRead | undefined {
	const done = { ...ONLY_CARRY, done: [Number(NAMED), Number(NAMED_TOO)] }

	return backlog_drive_named.offer(done, state(), true)
}

describe('backlog_drive_named.own_carried', () => {
	it('drops a carried lane the --only run does not name', () => {
		expect(backlog_drive_named.own_carried(ONLY_CARRY, [FOREIGN, NAMED], true)).toStrictEqual([
			NAMED,
		])
	})

	it('keeps a carried lane run:add put into the --only run', () => {
		const carry = { ...ONLY_CARRY, added: [{ issue: Number(FOREIGN), is_priority: false }] }

		expect(backlog_drive_named.own_carried(carry, [FOREIGN], true)).toStrictEqual([FOREIGN])
	})

	it('keeps every carried lane for a run that drains the pool', () => {
		expect(seeded(DRAINING_CARRY, false)).toStrictEqual([FOREIGN, NAMED, NAMED_TOO])
	})
})

describe('backlog_drive.run_loop — a --only run beside a foreign carried lane', () => {
	it('finishes once both named issues merge', async () => {
		const { ports, calls } = harness({ finished: [NAMED, NAMED_TOO], offers: [only_finish()] })
		const end = await backlog_drive.run_loop(state(seeded(ONLY_CARRY, true)), BOUNDED, ports)

		expect(end).toMatchObject({ reason: 'stop', is_finish: true })
		expect(calls).toStrictEqual([`merge ${NAMED}`, `merge ${NAMED_TOO}`, 'offer', 'finish'])
	})

	it('finishes when one named issue parks and the other merges', async () => {
		const { ports, calls } = harness({
			finished: [NAMED, NAMED_TOO],
			parked: [NAMED],
			offers: [only_finish()],
		})
		const end = await backlog_drive.run_loop(state(seeded(ONLY_CARRY, true)), BOUNDED, ports)

		expect(end.reason).toBe('stop')
		expect(calls.at(-1)).toBe('finish')
	})
})
