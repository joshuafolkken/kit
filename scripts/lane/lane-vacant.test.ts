import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'

const probes = vi.hoisted(() => ({
	commit_count_beyond: vi.fn(),
	default_branch_reference: vi.fn(),
	is_tree_dirty: vi.fn(),
	is_process_running_default: vi.fn(),
}))

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		commit_count_beyond: probes.commit_count_beyond,
		default_branch_reference: probes.default_branch_reference,
	},
}))
vi.mock('#scripts/run/run-hold', () => ({ run_hold: { is_tree_dirty: probes.is_tree_dirty } }))
vi.mock('./lane-await', () => ({
	lane_await: { is_process_running_default: probes.is_process_running_default },
}))

const { lane_vacant } = await import('./lane-vacant')

const BASE = 'refs/remotes/origin/main'
const LANE: LaneInfo = {
	issue: '17',
	branch: '17-lane',
	directory: '/lanes/17',
	seat: 1,
	development_port: 5173,
	preview_port: 4173,
	output: undefined,
	is_stranded: false,
}

beforeEach(() => {
	probes.default_branch_reference.mockResolvedValue(BASE)
	probes.commit_count_beyond.mockResolvedValue(0)
	probes.is_tree_dirty.mockResolvedValue(false)
	probes.is_process_running_default.mockReturnValue(false)
})

// joshuafolkken/kit#3289: only a lane holding nothing at all may be closed and opened afresh.
describe('lane_vacant.is_vacant', () => {
	it('answers vacant for a lane with no commit, a clean tree and no live process', async () => {
		expect(await lane_vacant.is_vacant(LANE)).toBe(true)
		expect(probes.commit_count_beyond).toHaveBeenCalledWith(BASE, LANE.branch)
		expect(probes.is_tree_dirty).toHaveBeenCalledWith(LANE.directory)
	})

	it('keeps a lane whose branch carries a commit', async () => {
		probes.commit_count_beyond.mockResolvedValue(1)

		expect(await lane_vacant.is_vacant(LANE)).toBe(false)
	})

	it('keeps a lane whose work tree has changes', async () => {
		probes.is_tree_dirty.mockResolvedValue(true)

		expect(await lane_vacant.is_vacant(LANE)).toBe(false)
	})

	it('keeps a lane whose child is still alive', async () => {
		probes.is_process_running_default.mockReturnValue(true)

		expect(await lane_vacant.is_vacant(LANE)).toBe(false)
	})

	it('keeps a stranded lane', async () => {
		expect(await lane_vacant.is_vacant({ ...LANE, is_stranded: true })).toBe(false)
	})

	// Closing deletes the branch, so a count nobody could read never licenses it.
	it('keeps a lane whose commits cannot be counted', async () => {
		probes.commit_count_beyond.mockRejectedValue(new Error('rev-list failed'))

		expect(await lane_vacant.is_vacant(LANE)).toBe(false)
	})
})
