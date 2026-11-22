import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { core_budget, type ReserveOptions } from './core-budget'
import type { WaitSink } from './core-wait-record'
import { core_weights } from './core-weights'
import type { MachineReading } from './machine-capacity'

const MEMORY_MB = 2400
const LOW_MB = 500
const CAP_MS = 10
const COMMAND = 'lint:related'
const MEASUREMENT_FAILED = 'measurement failed'
const PROBE_FAILED = 'probe failed'
const make_directory = temporary_directory()

afterEach(() => vi.unstubAllEnvs())

function memory_claim(
	read_machine: () => Promise<MachineReading>,
	options: ReserveOptions = {},
): ReturnType<typeof core_budget.claim> {
	return core_budget.claim(2, {
		directory: make_directory('josh-memory-admission-test-'),
		memory_mb: MEMORY_MB,
		command: COMMAND,
		read_machine,
		now: () => CAP_MS,
		wait_cap_ms: 0,
		ease_window_ms: 0,
		report: vi.fn(),
		record_wait: vi.fn(),
		...options,
	})
}

async function running_claim(
	read_machine: () => Promise<MachineReading>,
	options: ReserveOptions = {},
): Promise<ReturnType<typeof core_budget.claim>> {
	const claim = memory_claim(read_machine, options)

	await core_budget.poll_claim(claim)

	return claim
}

describe('memory admission after the deadline', () => {
	it.each([false, true])(
		'holds a lone claim with pressure=%s until memory recovers',
		async (pressure) => {
			const machine = { available_mb: LOW_MB, memory_pressured: pressure, busy_cores: 0 }
			const claim = memory_claim(async () => machine)

			try {
				expect(await core_budget.poll_claim(claim)).toBeUndefined()
				machine.memory_pressured = false
				expect(await core_budget.poll_claim(claim)).toBeUndefined()
				machine.available_mb = MEMORY_MB
				const handle = await core_budget.poll_claim(claim)

				expect(handle?.admission).toMatchObject({ overflow: undefined })
			} finally {
				core_budget.release(claim)
			}
		},
	)
})

describe('memory admission beside running claims', () => {
	it.each([0, CAP_MS])(
		'keeps memory enforced with wait cap %i beside a running claim',
		async (cap) => {
			const machine = { busy_cores: 0, available_mb: MEMORY_MB }
			const running = await running_claim(async () => machine)
			const waiting = memory_claim(async () => machine, {
				directory: running.directory,
				wait_cap_ms: cap,
			})

			try {
				expect(await core_budget.poll_claim(waiting)).toBeUndefined()
				core_budget.release(running)
				const handle = await core_budget.poll_claim(waiting)

				expect(handle?.admission).toMatchObject({ overflow: undefined })
			} finally {
				core_budget.release(running)
				core_budget.release(waiting)
			}
		},
	)
})

describe('memory admission probe failures', () => {
	it.each([
		{ reading: { available_mb: undefined, memory_supported: true }, reason: MEASUREMENT_FAILED },
		{ reading: { available_mb: NaN, memory_supported: true }, reason: MEASUREMENT_FAILED },
		{ reading: { available_mb: LOW_MB, total_mb: LOW_MB }, reason: 'exceeds physical memory' },
	])('refuses $reason and removes its waiting marker', async ({ reading, reason }) => {
		const claim = memory_claim(async () => ({ busy_cores: 0, ...reading }))

		await expect(core_budget.poll_claim(claim)).rejects.toThrow(reason)
		expect(core_budget.live_reservations(claim.directory)).toEqual([])
	})

	it('removes a claim when its machine probe throws', async () => {
		const claim = memory_claim(async () => {
			throw new Error(PROBE_FAILED)
		})

		await expect(core_budget.poll_claim(claim)).rejects.toThrow(PROBE_FAILED)
		expect(core_budget.live_reservations(claim.directory)).toEqual([])
	})
})

describe('memory admission on unsupported platforms', () => {
	it('keeps core-only fallback on an unsupported platform', async () => {
		const claim = memory_claim(async () => ({
			busy_cores: 0,
			available_mb: undefined,
			memory_supported: false,
		}))

		try {
			const handle = await core_budget.poll_claim(claim)

			expect(handle?.admission).toMatchObject({ overflow: undefined })
		} finally {
			core_budget.release(claim)
		}
	})
})

describe('memory admission of unit suites', () => {
	it('retains downstream worker narrowing when one worker fits physical memory', async () => {
		const claim = memory_claim(
			async () => ({
				busy_cores: 0,
				available_mb: LOW_MB,
				total_mb: LOW_MB,
				memory_supported: true,
			}),
			{ is_unit: true, memory_mb: LOW_MB * 2 },
		)

		try {
			const handle = await core_budget.poll_claim(claim)

			expect(handle?.admission.decision?.reason).toBe('unit-memory-narrowing')
		} finally {
			core_budget.release(claim)
		}
	})

	it('still holds a unit suite during memory pressure', async () => {
		const claim = memory_claim(
			async () => ({ busy_cores: 0, available_mb: LOW_MB, memory_pressured: true }),
			{ is_unit: true },
		)

		try {
			expect(await core_budget.poll_claim(claim)).toBeUndefined()
		} finally {
			core_budget.release(claim)
		}
	})
})

// joshuafolkken/kit#8473: the ledger's second `refactor:scan` overflowed beside a running one while
// memory was pressured, and the machine ran out of free memory.
const ESLINT_MB = core_weights.MEMORY_MB.eslint_scan
const PRESSURED_AVAILABLE_MB = 9400
const TOTAL_MB = 18_432
const PAST_RAMP_UP_MS = 40_000
const SATURATED_CORES = 10.96
const CPU_DEADLINE = 'cpu-deadline'
const OVERFLOW_PATHS = [
	{ reason: CPU_DEADLINE, wait_cap_ms: 0, ease_window_ms: PAST_RAMP_UP_MS },
	{ reason: 'cpu-unrelieved', wait_cap_ms: PAST_RAMP_UP_MS, ease_window_ms: 0 },
]
// A run queue past twice the cores lifts the first waiter's exemption from outside load.
const OVERLOADED_QUEUE = 30
const SATURATED = { busy_cores: SATURATED_CORES, run_queue: OVERLOADED_QUEUE }
const PRESSURED = { ...SATURATED, available_mb: PRESSURED_AVAILABLE_MB }

function scan_options(clock: { value: number }): ReserveOptions {
	return { memory_mb: ESLINT_MB, now: () => clock.value }
}

async function admission_reason(
	claim: ReturnType<typeof core_budget.claim>,
): Promise<string | undefined> {
	const handle = await core_budget.poll_claim(claim)

	return handle?.admission.decision?.reason
}

async function second_scan(
	pressured: boolean,
	path: (typeof OVERFLOW_PATHS)[number],
): Promise<string | undefined> {
	const clock = { value: CAP_MS }
	const machine = { busy_cores: 0, available_mb: TOTAL_MB, total_mb: TOTAL_MB }
	const running = await running_claim(async () => machine, scan_options(clock))

	clock.value += PAST_RAMP_UP_MS
	Object.assign(machine, pressured ? PRESSURED : SATURATED)
	const waiting = memory_claim(async () => ({ ...machine, memory_pressured: pressured }), {
		...scan_options(clock),
		...path,
		directory: running.directory,
	})

	try {
		return await admission_reason(waiting)
	} finally {
		core_budget.release(running)
		core_budget.release(waiting)
	}
}

describe('memory admission of a large claim under pressure', () => {
	it.each(OVERFLOW_PATHS)('holds a second ESLint claim from $reason overflow', async (path) => {
		expect(await second_scan(true, path)).toBeUndefined()
	})

	it.each(OVERFLOW_PATHS)('still overflows by $reason with memory to spare', async (path) => {
		expect(await second_scan(false, path)).toBe(path.reason)
	})
})

interface CommandProbe {
	directory: string
	machine: { busy_cores: number; available_mb: number }
	clock: { value: number }
	sink: ReturnType<typeof vi.fn<WaitSink>>
	run: ReturnType<typeof vi.fn<() => Promise<void>>>
}

function clear_parent_marks(): void {
	vi.stubEnv(core_budget.HELD_KEY, '')
	vi.stubEnv(unit_worker_share.NESTED_KEY, '')
}

function command_probe(waits: boolean): CommandProbe {
	return {
		directory: make_directory('josh-command-admission-test-'),
		machine: { busy_cores: 0, available_mb: waits ? LOW_MB : MEMORY_MB },
		clock: { value: CAP_MS },
		sink: vi.fn<WaitSink>().mockResolvedValue(undefined),
		run: vi.fn(async () => {
			expect(core_budget.is_held()).toBe(true)
		}),
	}
}

function command_options(probe: CommandProbe): ReserveOptions {
	return {
		directory: probe.directory,
		memory_mb: MEMORY_MB,
		command: COMMAND,
		now: () => probe.clock.value,
		read_machine: async () => probe.machine,
		report: vi.fn(),
		record_wait: probe.sink,
		sleep: async () => {
			probe.machine.available_mb = MEMORY_MB
			probe.clock.value += CAP_MS
		},
	}
}

describe('normal command admission evidence', () => {
	it.each([false, true])('records one decision with an initial wait=%s', async (waits) => {
		clear_parent_marks()
		const probe = command_probe(waits)

		await core_budget.with_command_reservation(2, probe.run, command_options(probe))
		expect(probe.sink).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				command: COMMAND,
				admission_reason: 'budget-fit',
				overflow: false,
				waited_ms: waits ? CAP_MS : 0,
				requested_cores: 2,
				granted_cores: 2,
				memory_mb: MEMORY_MB,
				available_mb: MEMORY_MB,
			}),
		)
		expect(probe.run).toHaveBeenCalledOnce()
		expect(core_budget.live_reservations(probe.directory)).toEqual([])
	})
})

describe('normal command CPU overflow evidence', () => {
	it('retains the deadline reason and memory budget when only cores overflow', async () => {
		clear_parent_marks()
		const probe = command_probe(false)
		const running = memory_claim(async () => probe.machine, {
			directory: probe.directory,
			memory_mb: 0,
		})

		await core_budget.poll_claim(running)

		try {
			await core_budget.with_command_reservation(2, probe.run, {
				...command_options(probe),
				budget: 1,
				wait_cap_ms: 0,
			})
			expect(probe.sink).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					admission_reason: CPU_DEADLINE,
					overflow: true,
					budget_memory_mb: MEMORY_MB,
					available_mb: MEMORY_MB,
				}),
			)
		} finally {
			core_budget.release(running)
		}
	})
})
