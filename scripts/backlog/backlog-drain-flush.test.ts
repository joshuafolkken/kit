import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drain_flush } from './backlog-drain-flush'

const ROOT = '/primary/checkout'
const SYNC = 'main:sync'
const FLUSH = 'observations:flush'
const FAILURE = 'observations:flush skipped: '

beforeEach(() => {
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(ROOT)
	vi.spyOn(josh_command, 'josh_run_at').mockResolvedValue({ code: 0, out: 'clean' })
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
})

describe('backlog_drain_flush.flush', () => {
	it('awaits default branch synchronization then flushes in the primary checkout', async () => {
		await backlog_drain_flush.flush()

		expect(josh_command.josh_run_at).toHaveBeenNthCalledWith(1, [SYNC], ROOT)
		expect(josh_command.josh_run_at).toHaveBeenLastCalledWith([FLUSH], ROOT)
		expect(console.error).not.toHaveBeenCalled()
	})

	it('continues after a failed flush and prints its multiline reason on one line', async () => {
		vi.mocked(josh_command.josh_run_at)
			.mockResolvedValueOnce({ code: 0, out: '' })
			.mockResolvedValueOnce({ code: 1, out: '', err: 'network failed\ntry later' })

		await expect(backlog_drain_flush.flush()).resolves.toBeUndefined()
		expect(console.error).toHaveBeenCalledExactlyOnceWith(`${FAILURE}network failed try later`)
	})

	it('skips the flush when the primary checkout cannot synchronize', async () => {
		vi.mocked(josh_command.josh_run_at).mockResolvedValue({ code: 1, out: 'dirty checkout' })

		await expect(backlog_drain_flush.flush()).resolves.toBeUndefined()
		expect(josh_command.josh_run_at).toHaveBeenCalledExactlyOnceWith([SYNC], ROOT)
		expect(console.error).toHaveBeenCalledExactlyOnceWith(`${FAILURE}dirty checkout`)
	})

	it('continues when resolving the primary checkout throws', async () => {
		vi.mocked(lane_registry.main_repository_root).mockRejectedValue(new Error('git failed'))

		await expect(backlog_drain_flush.flush()).resolves.toBeUndefined()
		expect(josh_command.josh_run_at).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledExactlyOnceWith(`${FAILURE}git failed`)
	})
})
