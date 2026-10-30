import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_ending } from '#scripts/run/run-ending'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4540: a host restart killed six lane children and cleared their transcripts, so
// `run:merge` counted each a failure and the third tripped the failure guard.

const uptime_mock = vi.hoisted(() => vi.fn())

vi.mock(import('node:os'), async (original) => ({ ...(await original()), uptime: uptime_mock }))

const { run_merge_restart } = await import('./run-merge-restart')

const CHILD = '4497'
const OUTPUT = '/Users/runner/.kit-lanes/4497/child.output'
const NOW_MS = Date.parse('2026-10-22T14:28:17.000Z')
const BOOTED_MS = Date.parse('2026-10-22T14:09:21.000Z')
const UPTIME_SECONDS = (NOW_MS - BOOTED_MS) / 1000
const BEFORE_BOOT_MS = Date.parse('2026-10-22T13:50:00.000Z')
const AFTER_BOOT_MS = Date.parse('2026-10-22T14:20:00.000Z')
const RESULT_LINE = JSON.stringify({
	type: 'result',
	subtype: 'success',
	is_error: false,
	num_turns: 1,
})
const TURN_LINE = JSON.stringify({ type: 'assistant' })

function dispatched(dispatched_ms: number | undefined): void {
	const lane: LaneInfo = {
		issue: CHILD,
		branch: `${CHILD}-lane`,
		directory: `/Users/runner/.kit-lanes/${CHILD}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: OUTPUT,
		dispatched_ms,
		is_stranded: false,
	}

	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(lane)
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.useFakeTimers({ now: NOW_MS })
	uptime_mock.mockReturnValue(UPTIME_SECONDS)
	vi.spyOn(run_ending, 'read_transcript').mockReturnValue(undefined)
})

describe('run_merge_restart.is_host_restart — unavailable host uptime', () => {
	it('does not infer a restart when host uptime is denied', async () => {
		dispatched(BEFORE_BOOT_MS)
		uptime_mock.mockImplementation(() => {
			throw Object.assign(new Error('uv_uptime returned EPERM'), { code: 'EPERM' })
		})

		await expect(run_merge_restart.is_host_restart(CHILD, OUTPUT)).resolves.toBe(false)
	})
})

describe('run_merge_restart.is_host_restart — a child the host restart killed', () => {
	it('reads a child dispatched before the host booted, with no exit record, as killed', async () => {
		dispatched(BEFORE_BOOT_MS)

		expect(await run_merge_restart.is_host_restart(CHILD, OUTPUT)).toBe(true)
	})

	it('reads it as killed when no transcript was named', async () => {
		dispatched(BEFORE_BOOT_MS)

		expect(await run_merge_restart.is_host_restart(CHILD, undefined)).toBe(true)
	})

	it('does not read a child dispatched after the host booted as killed', async () => {
		dispatched(AFTER_BOOT_MS)

		expect(await run_merge_restart.is_host_restart(CHILD, OUTPUT)).toBe(false)
	})

	it('does not read a child that ended itself before the restart as killed', async () => {
		dispatched(BEFORE_BOOT_MS)
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(`${TURN_LINE}\n${RESULT_LINE}\n`)

		expect(await run_merge_restart.is_host_restart(CHILD, OUTPUT)).toBe(false)
	})

	it('reads it as killed when only an earlier launch left an exit record in the log', async () => {
		dispatched(BEFORE_BOOT_MS)
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(`${RESULT_LINE}\n${TURN_LINE}\n`)

		expect(await run_merge_restart.is_host_restart(CHILD, OUTPUT)).toBe(true)
	})

	it('does not read a child whose dispatch time is unknown as killed', async () => {
		dispatched(undefined)

		expect(await run_merge_restart.is_host_restart(CHILD, OUTPUT)).toBe(false)
	})

	it('does not read a child with no open lane as killed', async () => {
		vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)

		expect(await run_merge_restart.is_host_restart(CHILD, OUTPUT)).toBe(false)
	})
})
