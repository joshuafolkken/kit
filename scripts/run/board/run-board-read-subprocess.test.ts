import { process_identity } from '#scripts/josh/process-identity'
import { lane_registry } from '#scripts/lane/lane-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

const { CARRY, MAIN_ROOT, arrange } = run_board_read_fixture
const START = 'Mon Oct 20 09:00:00 2026'
const row = { parent: 1, time: '0:00', rss_kb: 1, stat: 'S', start: START, command: 'claude' }

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#4263: a `git` or `ps` subprocess stalled the redraw's spinner while it ran.
describe('run_board_read.read_local subprocesses', () => {
	it('reads the main work tree once and every process start off the snapshot', async () => {
		arrange(
			{ kind: 'carried', carry: { ...CARRY, owner_pid: process.pid, owner_start: START } },
			undefined,
		)
		// Linux answers from `/proc` first; the snapshot's `ps` start is the one under test.
		vi.spyOn(process_identity.START_PROBES, 'read_proc_start').mockReturnValue(undefined)
		const read_ps_start = vi.spyOn(process_identity.START_PROBES, 'read_ps_start')
		const table = vi.fn(async () => [{ ...row, pid: process.pid }])

		await run_board_read.read_local(table)
		const main_root_calls = vi.mocked(lane_registry.main_repository_root).mock.calls.length

		await expect(run_board_read.read_local(table)).resolves.toMatchObject({
			roots: { parent: process.pid },
		})
		expect(lane_registry.main_repository_root).toHaveBeenCalledTimes(main_root_calls)
		expect(lane_registry.list_lanes).toHaveBeenCalledWith(MAIN_ROOT)
		expect(read_ps_start).not.toHaveBeenCalled()
	})

	it('takes no process snapshot where no run has started', async () => {
		arrange({ kind: 'none' }, undefined)
		const table = vi.fn(async () => [{ ...row, pid: process.pid }])

		await expect(run_board_read.read_local(table)).resolves.toBeUndefined()
		expect(table).not.toHaveBeenCalled()
	})

	it('resolves the main work tree again on the read after one that failed', async () => {
		arrange({ kind: 'carried', carry: CARRY }, undefined)
		// A directory no other test resolved, so the remembered root starts empty.
		vi.spyOn(process, 'cwd').mockReturnValue('/elsewhere')
		const failure = new Error('git timed out')

		vi.mocked(lane_registry.main_repository_root).mockRejectedValueOnce(failure)

		const table = vi.fn(async () => [{ ...row, pid: process.pid }])

		await expect(run_board_read.read_local(table)).rejects.toThrow(failure)
		await expect(run_board_read.read_local(table)).resolves.toMatchObject({ carry: CARRY })
		expect(lane_registry.list_lanes).toHaveBeenLastCalledWith(MAIN_ROOT)
	})
})
