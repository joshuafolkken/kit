import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'

// A bare `--only` names nothing: it starts idle and runs only what `run:add` puts in, under the idle
// watch, while a numbered `--only` still stops once its issues are done (joshuafolkken/kit#8923).

const { state } = backlog_drive_fixture
const ADDED = 8930
const ADDED_ID = String(ADDED)
const NAMED = 4263
const BARE_CARRY: RunCarry = {
	invocation: 'backlogrun --only',
	started_at: '2026-10-20T04:39:10.574Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const ADDED_CARRY: RunCarry = { ...BARE_CARRY, added: [{ issue: ADDED, is_priority: false }] }
const NUMBERED_DONE: RunCarry = {
	...BARE_CARRY,
	invocation: `backlogrun #${NAMED} --only`,
	done: [NAMED],
}
const OWNER = String(process.pid)
const IDLE_PAST_MS = 9 * 60 * 60 * 1000

function active_state(in_flight: ReadonlyArray<string> = [], ago_ms = 0): DriveState {
	const active = new Date(Date.now() - ago_ms).toISOString()

	return { ...state(in_flight), active }
}

async function bare_read(
	carry: RunCarry,
	drive: DriveState,
	forwarded: ReadonlyArray<string> = [],
): Promise<OfferRead | undefined> {
	const context = { is_only: true, forwarded, owner: OWNER }
	const read = await backlog_drive_named_offer.read(carry, drive, context)

	return read.offer
}

beforeEach(() => {
	vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(undefined)
	vi.spyOn(lane_dispatch_dependency, 'unfinished').mockResolvedValue([])
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: [], is_human_review: false },
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_named.offer — a bare --only run', () => {
	it('is idle rather than ended when nothing is added', () => {
		expect(backlog_drive_named.offer(BARE_CARRY, state(), true)).toBeUndefined()
	})

	it('still ends a numbered --only run once its issues are done', () => {
		const offer = backlog_drive_named.offer(NUMBERED_DONE, state(), true)

		expect(offer).toMatchObject({ verdict: 'stop', reason: 'only', is_finish: true })
	})
})

describe('backlog_drive_named_offer.read — a bare --only run under the idle watch', () => {
	it('watches while the idle watch has time left', async () => {
		expect(await bare_read(BARE_CARRY, active_state())).toMatchObject({ verdict: 'watch' })
	})

	it('stops at once under --idle 0', async () => {
		const offer = await bare_read(BARE_CARRY, active_state(), ['--idle', '0'])

		expect(offer).toMatchObject({ verdict: 'stop', is_finish: true })
	})

	it('stops once the idle watch runs out', async () => {
		const offer = await bare_read(BARE_CARRY, active_state([], IDLE_PAST_MS))

		expect(offer).toMatchObject({ verdict: 'stop', is_finish: true })
	})
})

describe('backlog_drive_named_offer.read — an issue run:add put into a bare --only run', () => {
	it('runs the added issue', async () => {
		const offer = await bare_read(ADDED_CARRY, active_state())

		expect(offer).toMatchObject({ verdict: 'run', issues: [ADDED_ID] })
	})

	it('waits while the added issue is in flight', async () => {
		const offer = await bare_read(ADDED_CARRY, active_state([ADDED_ID]))

		expect(offer).toMatchObject({ verdict: 'wait' })
	})

	it('watches again once the added issue merges', async () => {
		const merged = { ...ADDED_CARRY, done: [ADDED], merged_issues: [ADDED] }

		expect(await bare_read(merged, active_state())).toMatchObject({ verdict: 'watch' })
	})
})
