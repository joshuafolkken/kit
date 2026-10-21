import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_admission } from './core-admission'
import { core_budget } from './core-budget'
import type { WaitSink } from './core-wait-record'
import type { MachineReading } from './machine-capacity'

// joshuafolkken/kit#3943: a claim held back by the budget waited in silence. A waiting claim now
// records its command, checkout and reason on its marker for `run:board`, and says it once on its
// output.

const CORES = 11
const TOOL_MEMORY_MB = 2400
const BLOCKER = `${core_budget.RESERVED_PREFIX}blocker.json`
const UNREAD: MachineReading = { busy_cores: undefined, available_mb: undefined }
const PRESSURED: MachineReading = { busy_cores: 0, available_mb: 0, memory_pressured: true }

const probe = { directory: '' }

beforeEach(() => {
	probe.directory = mkdtempSync(path.join(tmpdir(), 'josh-core-budget-wait-test-'))
})

afterEach(() => {
	rmSync(probe.directory, { recursive: true, force: true })
})

function write_blocker(fields: object): void {
	const payload = { ...process_identity.own_fields(), claimed_at: 0, ...fields }

	writeFileSync(path.join(probe.directory, BLOCKER), JSON.stringify(payload))
}

function free_blocker(): void {
	rmSync(path.join(probe.directory, BLOCKER), { force: true })
}

// The blocker fills every core, so the claim waits two polls, reading the board's view at each.
async function records_and_prints_once(): Promise<void> {
	write_blocker({ weight: CORES, admitted_at: 0 })
	const report = vi.fn<(line: string) => void>()
	const seen: Array<ReturnType<typeof core_budget.budget_waits>> = []
	const sleep = vi.fn(async () => {
		seen.push(core_budget.budget_waits(probe.directory, 1))
		if (seen.length > 1) free_blocker()
	})
	const options = {
		directory: probe.directory,
		budget: CORES,
		command: 'lint',
		report,
		now: () => 1,
		sleep,
	}

	await core_budget.reserve(1, { ...options, read_machine: async () => UNREAD })

	const lane = lane_paths.lane_issue_of(process.cwd())
	const wait = { command: 'lint', lane, elsewhere: undefined, waited_ms: 0 }

	expect(seen).toStrictEqual([[{ ...wait, reason: 'cores' }], [{ ...wait, reason: 'cores' }]])
	expect(report.mock.calls).toStrictEqual([
		['⏳ lint waits for the core budget — not enough free cores'],
	])
}

// The blocker holds the tool's memory, ramped up, and the reading is pressured: nothing is free.
async function names_pressure(): Promise<void> {
	write_blocker({ weight: 1, memory_mb: TOOL_MEMORY_MB, admitted_at: -core_admission.RAMP_UP_MS })
	const report = vi.fn<(line: string) => void>()
	const handle = await core_budget.reserve(1, {
		directory: probe.directory,
		budget: CORES,
		memory_mb: TOOL_MEMORY_MB,
		read_machine: async () => PRESSURED,
		report,
		now: () => 1,
		sleep: async () => {
			free_blocker()
		},
	})

	expect(report).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('memory under pressure'))
	expect(JSON.parse(readFileSync(handle.target, 'utf8'))).toMatchObject({
		checkout: process.cwd(),
		wait_reason: 'pressure',
		admitted_at: 1,
	})
}

async function prints_nothing_solo(): Promise<void> {
	const report = vi.fn<(line: string) => void>()

	await core_budget.reserve(1, {
		directory: probe.directory,
		budget: CORES,
		report,
		read_machine: async () => UNREAD,
		now: () => 1,
	})

	expect(report).not.toHaveBeenCalled()
	expect(core_budget.budget_waits(probe.directory, 1)).toStrictEqual([])
}

// joshuafolkken/kit#4382: an admitted claim that waited records how long, so a lane's time splits
// into work and waiting.
const WAITED_MS = 500

async function records_its_wait(): Promise<void> {
	write_blocker({ weight: CORES, admitted_at: 0 })
	const clock = { now: 1 }
	const record_wait = vi.fn<WaitSink>().mockResolvedValue(undefined)

	await core_budget.reserve(1, {
		directory: probe.directory,
		budget: CORES,
		command: 'lint',
		report: vi.fn<(line: string) => void>(),
		read_machine: async () => UNREAD,
		now: () => clock.now,
		sleep: async () => {
			clock.now += WAITED_MS
			free_blocker()
		},
		record_wait,
	})

	const lane = lane_paths.lane_issue_of(process.cwd())
	const issue = lane === undefined ? {} : { issue: Number(lane) }

	expect(record_wait).toHaveBeenCalledExactlyOnceWith({
		command: 'lint',
		waited_ms: WAITED_MS,
		...issue,
	})
}

async function records_no_wait_solo(): Promise<void> {
	const record_wait = vi.fn<WaitSink>().mockResolvedValue(undefined)

	await core_budget.reserve(1, {
		directory: probe.directory,
		budget: CORES,
		read_machine: async () => UNREAD,
		now: () => 1,
		record_wait,
	})

	expect(record_wait).not.toHaveBeenCalled()
}

describe('core_budget.reserve — how long a claim waited', () => {
	it('records the command, the wait and the lane once it is admitted', records_its_wait)
	it('records nothing for a claim admitted at once', records_no_wait_solo)
})

describe('core_budget.reserve — a claim that waits says why', () => {
	it(
		'records the command, checkout and reason on its marker, and prints the start once',
		records_and_prints_once,
	)
	it('names memory pressure when the reading saw compression or swap', names_pressure)
	it('prints nothing for a claim admitted at once', prints_nothing_solo)
})
