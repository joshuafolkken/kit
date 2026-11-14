import { git_common_directory } from '#scripts/git/git-common-directory'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { detached_launch } from '#scripts/run/detached-launch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drain_flush } from './backlog-drain-flush'
import { backlogrun_launch } from './backlogrun-launch'

const ROOT = '/primary/checkout'
const SYNC = 'main:sync'
const FLUSH = 'observations:flush'
const FAILURE = 'observations:flush skipped: '
const DURATION = 'observations:flush finished in 213.7s'
const STARTED_MS = 1_000_000
const FLUSH_MS = 213_700
const COMMON = '/primary/checkout/.git'
const LANE = '/lanes/7505'

beforeEach(() => {
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(ROOT)
	vi.spyOn(josh_command, 'josh_run_at').mockResolvedValue({ code: 0, out: 'clean' })
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
})

function clock(): () => number {
	return vi
		.fn()
		.mockReturnValueOnce(STARTED_MS)
		.mockReturnValueOnce(STARTED_MS + FLUSH_MS)
}

describe('backlog_drain_flush.flush', () => {
	it('awaits default branch synchronization then flushes in the primary checkout', async () => {
		await backlog_drain_flush.flush(clock())

		expect(josh_command.josh_run_at).toHaveBeenNthCalledWith(1, [SYNC], ROOT)
		expect(josh_command.josh_run_at).toHaveBeenLastCalledWith([FLUSH], ROOT)
		expect(console.error).toHaveBeenCalledExactlyOnceWith(DURATION)
	})

	it('continues after a failed flush and prints its multiline reason on one line', async () => {
		vi.mocked(josh_command.josh_run_at)
			.mockResolvedValueOnce({ code: 0, out: '' })
			.mockResolvedValueOnce({ code: 1, out: '', err: 'network failed\ntry later' })

		await expect(backlog_drain_flush.flush(clock())).resolves.toBeUndefined()
		expect(console.error).toHaveBeenNthCalledWith(1, `${FAILURE}network failed try later`)
		expect(console.error).toHaveBeenLastCalledWith(DURATION)
	})

	it('skips the flush when the primary checkout cannot synchronize', async () => {
		vi.mocked(josh_command.josh_run_at).mockResolvedValue({ code: 1, out: 'dirty checkout' })

		await expect(backlog_drain_flush.flush()).resolves.toBeUndefined()
		expect(josh_command.josh_run_at).toHaveBeenCalledExactlyOnceWith([SYNC], ROOT)
		expect(console.error).toHaveBeenNthCalledWith(1, `${FAILURE}dirty checkout`)
	})

	it('continues when resolving the primary checkout throws', async () => {
		vi.mocked(lane_registry.main_repository_root).mockRejectedValue(new Error('git failed'))

		await expect(backlog_drain_flush.flush()).resolves.toBeUndefined()
		expect(josh_command.josh_run_at).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenNthCalledWith(1, `${FAILURE}git failed`)
	})
})

// joshuafolkken/kit#7505: a detached launch is what lets the flush outlive a driver that ends meanwhile.
describe('backlog_drain_flush.start', () => {
	beforeEach(() => {
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(COMMON)
	})

	it('launches the flush body detached, its output appended to the backlogrun log', () => {
		const launch = vi
			.spyOn(detached_launch, 'launch')
			.mockReturnValue({ kind: 'launched', pid: 42 })

		backlog_drain_flush.start(LANE)

		expect(launch).toHaveBeenCalledExactlyOnceWith(
			{
				argv: { command: 'pnpm', args: ['josh', 'backlog:offer', '--drain-flush'] },
				cwd: LANE,
				log_path: backlogrun_launch.log_path(COMMON),
			},
			expect.any(Function),
		)
		expect(console.error).not.toHaveBeenCalled()
	})

	it('prints a launch that failed as a skipped flush', () => {
		vi.spyOn(detached_launch, 'launch').mockReturnValue({ kind: 'failed', note: 'no\npnpm' })

		backlog_drain_flush.start(LANE)

		expect(console.error).toHaveBeenCalledExactlyOnceWith(`${FAILURE}no pnpm`)
	})
})
