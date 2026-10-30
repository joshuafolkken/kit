import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { core_budget, type ReserveOptions } from '#scripts/gate/core-budget'
import { core_wait } from '#scripts/gate/core-wait'
import type { MachineReading } from '#scripts/gate/machine-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_launch_admission } from './lane-launch-admission'
import type { LaunchContext, LaunchOutcome } from './lane-launch-cli'
import { lane_paths } from './lane-paths'

const CONTEXT: LaunchContext = { issue: '17', stash: undefined }
const LAUNCHED: LaunchOutcome = { kind: 'launched', pid: String(process.pid) }
const WAIT_MS = 200_000
const MEMORY_MB = 270
const { reserve } = core_budget
const LAUNCH_COMMAND = 'lane:launch'
const HELD_ERROR = 'still held'
const probe = { directory: '', now: 1, polls: 0 }

beforeEach(() => {
	probe.directory = mkdtempSync(path.join(tmpdir(), 'josh-lane-launch-admission-'))
	probe.now = 1
	probe.polls = 0
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(probe.directory, { recursive: true, force: true })
})

function stub_machine(
	read_machine: () => Promise<MachineReading>,
	sleep = async (): Promise<void> => undefined,
): void {
	vi.spyOn(core_budget, 'reserve').mockImplementation(
		async (weight: number, options?: ReserveOptions) =>
			await reserve(weight, {
				...options,
				directory: probe.directory,
				read_machine,
				now: () => probe.now,
				sleep,
				report: vi.fn(),
				record_wait: vi.fn(),
			}),
	)
}

async function available(): Promise<MachineReading> {
	return { available_mb: MEMORY_MB, busy_cores: 0 }
}

async function launches_after_memory_recovers(): Promise<void> {
	const run = vi.fn(async (): Promise<LaunchOutcome> => LAUNCHED)
	const root = core_wait.where_of(process.cwd()).lanes_root ?? ''

	stub_machine(
		async () => ({ available_mb: probe.polls > 1 ? MEMORY_MB : MEMORY_MB - 1, busy_cores: 0 }),
		async () => {
			expect(run).not.toHaveBeenCalled()
			expect(core_budget.budget_waits(probe.directory, probe.now)).toMatchObject([
				{ command: LAUNCH_COMMAND, lane: CONTEXT.issue, reason: 'memory' },
			])
			probe.now += WAIT_MS
			probe.polls += 1
		},
	)

	expect(await lane_launch_admission.launch(CONTEXT, run)).toEqual(LAUNCHED)
	expect(run).toHaveBeenCalledExactlyOnceWith(CONTEXT)
	expect(core_budget.live_reservations(probe.directory)[0]?.reservation).toMatchObject({
		memory_mb: MEMORY_MB,
		checkout: lane_paths.lane_directory(root, CONTEXT.issue),
		is_memory_pending: false,
	})
}

describe('lane_launch_admission.launch — memory admission', () => {
	it(
		'waits alone past the cap, exposes its target lane and launches only after memory recovers',
		launches_after_memory_recovers,
	)

	it('launches immediately with enough memory and leaves the child reservation live', async () => {
		stub_machine(available)

		expect(await lane_launch_admission.launch(CONTEXT, async () => LAUNCHED)).toEqual(LAUNCHED)
		expect(core_budget.live_reservations(probe.directory)).toHaveLength(1)
		expect(core_budget.live_reservations(probe.directory)[0]?.reservation.pid).toBe(process.pid)
	})

	it('keeps simultaneous starts from spending memory not yet reflected in the machine reading', async () => {
		stub_machine(available, async () => {
			expect(core_budget.budget_waits(probe.directory, probe.now)[0]?.reason).toBe('memory')
			throw new Error(HELD_ERROR)
		})
		await lane_launch_admission.launch(CONTEXT, async () => LAUNCHED)

		await expect(lane_launch_admission.launch(CONTEXT, async () => LAUNCHED)).rejects.toThrow(
			HELD_ERROR,
		)
	})
})

describe('lane_launch_admission.launch — failures', () => {
	it.each(['unopened', 'failed'] as const)('releases the claim when launch is %s', async (kind) => {
		stub_machine(available)

		expect(await lane_launch_admission.launch(CONTEXT, async () => ({ kind }))).toEqual({ kind })
		expect(core_budget.live_reservations(probe.directory)).toEqual([])
	})

	it('releases the claim when launch throws', async () => {
		stub_machine(available)

		await expect(
			lane_launch_admission.launch(CONTEXT, async () => {
				throw new Error('failed')
			}),
		).rejects.toThrow('failed')
		expect(core_budget.live_reservations(probe.directory)).toEqual([])
	})
})
