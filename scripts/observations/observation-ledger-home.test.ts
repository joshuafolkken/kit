import path from 'node:path'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OBSERVATION_LEDGER_PATH } from './observation-ledger'
import { observation_ledger_home } from './observation-ledger-home'

vi.mock('#scripts/discovery/repo-discovery', () => ({
	repo_discovery: { main_worktree: vi.fn() },
}))

const PRIMARY = path.resolve('/work/kit')
const LANE = path.resolve('/work/.kit-lanes/2419')

const mocked_main_worktree = vi.mocked(repo_discovery.main_worktree)

beforeEach(() => {
	vi.clearAllMocks()
	mocked_main_worktree.mockReturnValue(PRIMARY)
})

describe('observation_ledger_home — in the primary checkout', () => {
	it('places the ledger in the checkout itself', () => {
		expect(observation_ledger_home.ledger_path(PRIMARY)).toBe(
			path.join(PRIMARY, OBSERVATION_LEDGER_PATH),
		)
	})

	it('is not a lane', () => {
		expect(observation_ledger_home.is_lane(PRIMARY)).toBe(false)
	})
})

describe('observation_ledger_home — in a lane', () => {
	it('places the ledger in the primary checkout, not the lane', () => {
		expect(observation_ledger_home.ledger_path(LANE)).toBe(
			path.join(PRIMARY, OBSERVATION_LEDGER_PATH),
		)
		expect(mocked_main_worktree).toHaveBeenCalledWith(LANE)
	})

	it('is a lane', () => {
		expect(observation_ledger_home.is_lane(LANE)).toBe(true)
	})

	it('names the primary checkout as the root', () => {
		expect(observation_ledger_home.ledger_root(LANE)).toBe(PRIMARY)
	})
})
