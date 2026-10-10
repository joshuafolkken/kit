import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { hanging_execa } from '#scripts/test/hanging-execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { machine_capacity } from './machine-capacity'

// joshuafolkken/kit#3590: the memory probes carried no timeout. They run at the gate's admission and
// once a second under `run:board`, so a `sysctl` or `getconf` that never answered held both open.

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#scripts/test/hanging-execa')

	return { execa: stand_in.spawn }
})

function stub_platform(platform: NodeJS.Platform): void {
	vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
}

beforeEach(() => {
	vi.useFakeTimers()
	hanging_execa.reset()
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('machine_capacity.read_sample against a probe that never answers', () => {
	it('leaves the macOS memory unread once the sysctl budget is spent', async () => {
		stub_platform('darwin')

		const pending = machine_capacity.read_sample()

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		const { memory } = await pending

		expect(memory).toStrictEqual({
			available_mb: undefined,
			swapped_mb: undefined,
			pressure_level: undefined,
		})
		expect(hanging_execa.timeouts()).toStrictEqual([PROBE_TIMEOUT_MS])
	})

	it('leaves the Linux swap unread once the getconf budget is spent', async () => {
		stub_platform('linux')

		const pending = machine_capacity.read_sample()

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		const { memory } = await pending

		expect(memory.swapped_mb).toBeUndefined()
		expect(hanging_execa.timeouts()).toStrictEqual([PROBE_TIMEOUT_MS])
	})
})
