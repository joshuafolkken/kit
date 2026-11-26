import type { EpicChild } from '#scripts/epic/epic-graph'
import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { backlog_drive, type OfferRead } from './backlog-drive'
import { backlog_drive_named_gate } from './backlog-drive-named-gate'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'

// joshuafolkken/kit#8965: an added issue whose blockers are unfinished waits at the offer, so the
// added issues behind it launch, and it is offered again once its blockers close.

const ACTIVE = new Date().toISOString()
const BLOCKED = 8940
const LATER = 8959
const BLOCKER = 8944
const CONTEXT = { is_only: true, forwarded: [], owner: String(process.pid) }
const ONLY = 'backlogrun --only'
const BLOCKER_CHILD: EpicChild = {
	number: BLOCKER,
	repo: 'joshuafolkken/kit',
	state: 'OPEN',
	labels: [],
	body: '',
	blocked_by: [],
}

function carry_of(added: ReadonlyArray<number>, invocation = ONLY): RunCarry {
	return {
		invocation,
		started_at: ACTIVE,
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
		added: added.map((issue) => ({ issue, is_priority: false })),
	}
}

function blocked_by_open(): ReturnType<typeof vi.spyOn> {
	return vi
		.spyOn(lane_dispatch_dependency, 'unfinished')
		.mockImplementation(async (issue) => (issue === String(BLOCKED) ? [BLOCKER_CHILD] : []))
}

async function offer_of(carry: RunCarry): Promise<OfferRead | undefined> {
	const state = backlog_drive.initial_state([], ACTIVE)
	const { offer } = await backlog_drive_named_offer.read(carry, state, CONTEXT)

	return offer
}

beforeEach(() => {
	vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(undefined)
	vi.spyOn(backlog_drive_named_gate, 'admitted').mockImplementation(async (plain) =>
		plain.map((issue) => issue.number),
	)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: [], is_human_review: false },
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

test('passes an added issue with an unfinished blocker and runs the added issue behind it', async () => {
	blocked_by_open()

	const offer = await offer_of(carry_of([BLOCKED, LATER]))

	expect(offer).toMatchObject({ verdict: 'run', issues: [String(LATER)] })
})

test('offers the passed issue again once its blocker closes', async () => {
	const unfinished = blocked_by_open()
	const carry = carry_of([BLOCKED, LATER])

	await offer_of(carry)
	unfinished.mockResolvedValue([])

	expect(await offer_of(carry)).toMatchObject({
		verdict: 'run',
		issues: [String(BLOCKED), String(LATER)],
	})
})

test('runs nothing when only blocked issues remain, so no dispatch repeats each tick', async () => {
	blocked_by_open()

	const offer = await offer_of(carry_of([BLOCKED]))

	expect(offer?.verdict).not.toBe('run')
})

test('leaves an unreadable blocker read to lane:dispatch', async () => {
	vi.spyOn(lane_dispatch_dependency, 'unfinished').mockRejectedValue(new Error('offline'))

	const offer = await offer_of(carry_of([BLOCKED, LATER]))

	expect(offer).toMatchObject({ verdict: 'run', issues: [String(BLOCKED), String(LATER)] })
})

test('passes a declared issue with an unfinished blocker like an added one', async () => {
	blocked_by_open()
	const invocation = `backlogrun #${String(BLOCKED)} #${String(LATER)} --only`

	const offer = await offer_of(carry_of([], invocation))

	expect(offer).toMatchObject({ verdict: 'run', issues: [String(LATER)] })
})
