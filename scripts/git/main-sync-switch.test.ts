import { lane_reap } from '#scripts/lane/lane-reap'
import { run_hold_live } from '#scripts/run/hold/run-hold-live'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'
import { main_sync_switch, type SwitchReaders } from './main-sync-switch'

// joshuafolkken/kit#9106: the root checkout, held by #9096's run with 140 uncommitted changes on its ship
// branch, was switched to the default branch by a `main:sync` — its changes carried along.

const DEFAULT_BRANCH = 'main'
const SHIP_BRANCH = '9096-ship-lane'
const RUN_PID = 4242
const OWN_PID = 777
const CLEAN = ''
const SOURCE_CHANGE = ' M scripts/git/main-sync.ts'
const LEDGER_APPEND = ' M .josh/observations/9096.md'
const RUN_HOLD = { issue: '9096', pid: RUN_PID }
const ROOT = '/repo'

function readers(overrides: Partial<SwitchReaders> = {}): SwitchReaders {
	return {
		branch: async () => await SHIP_BRANCH,
		status: async () => await CLEAN,
		live_hold: async () => await undefined,
		ancestry: () => new Set([OWN_PID]),
		...overrides,
	}
}

async function refusal_of(overrides: Partial<SwitchReaders>): Promise<string | undefined> {
	return await main_sync_switch.refusal(DEFAULT_BRANCH, readers(overrides))
}

describe('refusing to switch a checkout in use', () => {
	it('refuses a checkout with uncommitted changes outside the ledger, naming them', async () => {
		const reason = await refusal_of({ status: async () => await SOURCE_CHANGE })

		expect(reason).toContain(`will not switch ${SHIP_BRANCH} to ${DEFAULT_BRANCH}`)
		expect(reason).toContain('scripts/git/main-sync.ts')
	})

	it('refuses a clean checkout another run holds live, naming that run', async () => {
		const reason = await refusal_of({ live_hold: async () => await RUN_HOLD })

		expect(reason).toContain('#9096')
	})
})

describe('reading the checkout by default', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("reads the branch, status, root's hold and own ancestry when no readers are passed", async () => {
		vi.spyOn(git_command, 'branch').mockResolvedValue(SHIP_BRANCH)
		vi.spyOn(git_command, 'status').mockResolvedValue(CLEAN)
		vi.spyOn(git_command, 'repository_root').mockResolvedValue(ROOT)
		const live_hold = vi.spyOn(run_hold_live, 'live_hold').mockReturnValue(RUN_HOLD)

		vi.spyOn(lane_reap, 'own_ancestry').mockReturnValue(new Set([OWN_PID]))

		expect(await main_sync_switch.refusal(DEFAULT_BRANCH)).toContain('#9096')
		expect(live_hold).toHaveBeenCalledWith(ROOT)
	})
})

describe('switching a checkout nothing else uses', () => {
	// A stale hold names no live owner (`run-hold-live.ts`), so the next run takes a clean tree as before.
	it('switches a clean checkout whose hold is stale', async () => {
		expect(await refusal_of({})).toBeUndefined()
	})

	it('switches when the only changes are ledger lines, which run:tail carries over', async () => {
		expect(await refusal_of({ status: async () => await LEDGER_APPEND })).toBeUndefined()
	})

	it("switches under the caller's own live hold, as run:tail closing its run does", async () => {
		const own = { live_hold: async () => await RUN_HOLD }

		expect(await refusal_of({ ...own, ancestry: () => new Set([RUN_PID]) })).toBeUndefined()
	})

	it('never refuses on the default branch, where no switch happens', async () => {
		const dirty = { status: async () => await SOURCE_CHANGE }

		expect(await refusal_of({ ...dirty, branch: async () => await DEFAULT_BRANCH })).toBeUndefined()
	})
})
