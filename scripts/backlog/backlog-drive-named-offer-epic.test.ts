import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { backlog_drive, type OfferRead } from './backlog-drive'
import { backlog_drive_epic } from './backlog-drive-epic'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'

// joshuafolkken/kit#6840: an epic `run:add` put in whose children all wait holds nothing up — the
// declared issue behind it, or the pool, fills the free lane — while a declared epic still holds.

const ACTIVE = new Date().toISOString()
const EPIC = 5
const DECLARED = 1
const CHILD = '7'
const CONTEXT = { is_only: false, forwarded: ['--max', '2'], owner: String(process.pid) }
const WAIT: OfferRead = { verdict: 'wait', issues: [], retries: 0 }
const POOL_RUN = 'backlogrun --max 2'

function carry_of(invocation: string): RunCarry {
	return {
		invocation,
		started_at: ACTIVE,
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
		added: [{ issue: EPIC, is_priority: true }],
	}
}

function epic_answers(answer: OfferRead): void {
	vi.spyOn(issue_state_cli, 'read_issue').mockImplementation(async (issue) => ({
		kind: 'state',
		state: {
			state: 'OPEN',
			labels: issue === String(EPIC) ? ['epic'] : [],
			is_human_review: false,
		},
	}))
	vi.spyOn(backlog_drive_epic, 'offer').mockResolvedValue(answer)
}

async function offer_of(invocation: string): Promise<OfferRead | undefined> {
	const state = { ...backlog_drive.initial_state([], ACTIVE), in_flight: [CHILD] }
	const { offer } = await backlog_drive_named_offer.read(carry_of(invocation), state, CONTEXT)

	return offer
}

beforeEach(() => {
	vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

test('offers the declared issue behind an added epic whose children wait', async () => {
	epic_answers(WAIT)

	const offer = await offer_of(`backlogrun #${String(DECLARED)}`)

	expect(offer).toMatchObject({ verdict: 'run', issues: [String(DECLARED)] })
})

test('names nothing in a pool run while its added epic waits, so the pool is asked', async () => {
	epic_answers(WAIT)

	expect(await offer_of(POOL_RUN)).toBeUndefined()
})

// The round-2 finding: with no lane of the run's own in flight, a pool that counted nothing running
// would read the drain while the epic is still open.
test('counts the passed epic running in the pool, so an idle run does not drain past it', async () => {
	epic_answers(WAIT)
	const state = backlog_drive.initial_state([], ACTIVE)

	const { offer, pool } = await backlog_drive_named_offer.read(carry_of(POOL_RUN), state, CONTEXT)

	expect(offer).toBeUndefined()
	expect(pool.in_flight).toStrictEqual([String(EPIC)])
})

test('still waits on an added epic whose read failed, so its retries count', async () => {
	const failed = { ...WAIT, retries: 1 }

	epic_answers(failed)

	expect(await offer_of(POOL_RUN)).toStrictEqual(failed)
})

test('still holds the issues declared after a declared epic that waits', async () => {
	epic_answers(WAIT)

	const offer = await offer_of(`backlogrun #${String(EPIC)} #${String(DECLARED)}`)

	expect(offer).toStrictEqual(WAIT)
})
