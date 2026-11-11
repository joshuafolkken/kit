import type { RusageReader } from '#scripts/run/board/run-board-usage-rusage'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('./eslint-daemon', () => ({
	eslint_daemon: { read_record: vi.fn(), stop: vi.fn() },
}))
vi.mock('./eslint-warm', () => ({ eslint_warm: { start: vi.fn() } }))

const { eslint_daemon } = await import('./eslint-daemon')
const { eslint_warm } = await import('./eslint-warm')
const { eslint_trim } = await import('./eslint-trim')

// joshuafolkken/kit#7246: a daemon that outgrew a fresh one is restarted by the warm-up, off the edit.

const PROJECT_ROOT = '/project'
const PID = 4242
const RECORD = `token 1234 ${String(PID)} hash`
const LIMIT_BYTES = eslint_trim.FOOTPRINT_LIMIT_MB * eslint_trim.BYTES_PER_MB

function reader_of(footprint_bytes: number): Mock<RusageReader> {
	return vi.fn<RusageReader>(() => ({ cpu_ms: 0, footprint_bytes }))
}

beforeEach(() => {
	vi.mocked(eslint_daemon.read_record).mockReturnValue({ daemon: RECORD, recorded: undefined })
	vi.mocked(eslint_daemon.stop).mockResolvedValue(true)
})

describe('eslint_trim.trim', () => {
	it('stops a daemon past the limit and warms its replacement', async () => {
		const reader = reader_of(LIMIT_BYTES + 1)

		expect(await eslint_trim.trim(PROJECT_ROOT, reader)).toBe(true)
		expect(reader).toHaveBeenCalledWith(PID)
		expect(eslint_daemon.stop).toHaveBeenCalledWith(PROJECT_ROOT)
		expect(eslint_warm.start).toHaveBeenCalledWith(PROJECT_ROOT)
	})

	it('keeps a daemon at or under the limit', async () => {
		expect(await eslint_trim.trim(PROJECT_ROOT, reader_of(LIMIT_BYTES))).toBe(false)
		expect(eslint_daemon.stop).not.toHaveBeenCalled()
		expect(eslint_warm.start).not.toHaveBeenCalled()
	})

	it('measures nothing when no daemon is recorded', async () => {
		vi.mocked(eslint_daemon.read_record).mockReturnValue({ daemon: undefined, recorded: undefined })
		const reader = reader_of(LIMIT_BYTES + 1)

		expect(await eslint_trim.trim(PROJECT_ROOT, reader)).toBe(false)
		expect(reader).not.toHaveBeenCalled()
	})

	it('keeps the daemon where no footprint can be read', async () => {
		expect(
			await eslint_trim.trim(
				PROJECT_ROOT,
				vi.fn(() => undefined),
			),
		).toBe(false)
		expect(eslint_daemon.stop).not.toHaveBeenCalled()
	})

	it('warms nothing when the daemon was not this checkout to stop', async () => {
		vi.mocked(eslint_daemon.stop).mockResolvedValue(false)

		expect(await eslint_trim.trim(PROJECT_ROOT, reader_of(LIMIT_BYTES + 1))).toBe(false)
		expect(eslint_warm.start).not.toHaveBeenCalled()
	})
})
