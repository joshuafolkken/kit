import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { backlog_drive } from '#scripts/backlog/backlog-drive'
import { backlog_drive_fixture } from '#scripts/backlog/backlog-drive-fixture'
import { core_budget, type ReserveOptions } from '#scripts/gate/core-budget'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchContext, LaunchOutcome } from './lane-launch-cli'
import { lane_launch_pending } from './lane-launch-pending'

const { claim } = core_budget
const CONTEXT: LaunchContext = { issue: '17', stash: undefined }
const LAUNCHED: LaunchOutcome = { kind: 'launched', pid: String(process.pid) }
const MEMORY_MB = 270
const probe = { directory: '', available: 0 }

beforeEach(() => {
	probe.directory = mkdtempSync(path.join(tmpdir(), 'josh-lane-launch-pending-'))
	probe.available = 0
	vi.spyOn(core_budget, 'claim').mockImplementation((weight: number, options?: ReserveOptions) =>
		claim(weight, {
			...options,
			directory: probe.directory,
			report: vi.fn(),
			record_wait: vi.fn(),
			read_machine: async () => ({ available_mb: probe.available, busy_cores: 0 }),
		}),
	)
})

afterEach(() => {
	lane_launch_pending.keep([])
	vi.restoreAllMocks()
	rmSync(probe.directory, { recursive: true, force: true })
})

describe('lane_launch_pending.launch', () => {
	it('keeps one visible claim between passes and starts only after memory is free', async () => {
		const run = vi.fn(async (): Promise<LaunchOutcome> => LAUNCHED)

		expect(await lane_launch_pending.launch(CONTEXT, run)).toEqual({ kind: 'waiting' })
		expect(await lane_launch_pending.launch(CONTEXT, run)).toEqual({ kind: 'waiting' })
		expect(run).not.toHaveBeenCalled()
		expect(core_budget.live_reservations(probe.directory)).toHaveLength(1)
		expect(core_budget.budget_waits(probe.directory)[0]).toMatchObject({
			lane: '17',
			reason: 'memory',
		})
		probe.available = MEMORY_MB

		expect(await lane_launch_pending.launch(CONTEXT, run)).toEqual(LAUNCHED)
		expect(run).toHaveBeenCalledOnce()
	})

	// joshuafolkken/kit#5519: a pass launches its lanes side by side, each waiting on its own claim.
	it('keeps one waiting claim per issue when two lanes wait at once', async () => {
		const other: LaunchContext = { issue: '18', stash: undefined }
		const run = vi.fn(async (): Promise<LaunchOutcome> => LAUNCHED)

		await Promise.all([
			lane_launch_pending.launch(CONTEXT, run),
			lane_launch_pending.launch(other, run),
		])
		lane_launch_pending.keep([CONTEXT.issue])

		expect(core_budget.budget_waits(probe.directory).map((wait) => wait.lane)).toStrictEqual(['17'])
	})

	it('releases a waiting claim when the offer withdraws it or the driver exits', async () => {
		await lane_launch_pending.launch(CONTEXT, async () => LAUNCHED)
		lane_launch_pending.keep([])

		expect(core_budget.live_reservations(probe.directory)).toEqual([])
	})
})

describe('backlog drive with a real waiting launch claim', () => {
	it('continues collecting finished children and checks its window while memory stays unavailable', async () => {
		const { CONFIG, FIRST_CHILD, POLL_MS, harness, offer, state } = backlog_drive_fixture
		const { ports, calls } = harness({ offers: [offer('run', [CONTEXT.issue]), offer('wait')] })
		const run = vi.fn(async (): Promise<LaunchOutcome> => LAUNCHED)

		vi.spyOn(ports, 'launch').mockImplementation(async () => {
			const outcome = await lane_launch_pending.launch(CONTEXT, run)

			return outcome.kind
		})
		vi.spyOn(ports, 'is_finished').mockResolvedValueOnce(false).mockResolvedValue(true)
		const end = await backlog_drive.run_loop(
			state([FIRST_CHILD]),
			{ ...CONFIG, window_ms: POLL_MS },
			ports,
		)

		expect(calls).toContain(`merge ${FIRST_CHILD}`)
		expect(end.reason).toBe('window')
		expect(run).not.toHaveBeenCalled()
	})
})
