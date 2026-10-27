import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './lane-ledger'

// joshuafolkken/kit#3355: `lane:sample` appends one load sample and `lane:stats` prints the period's
// table row; a malformed verb or flag is refused rather than measured as a zero period.

const sample_mock = vi.hoisted(() => vi.fn())

vi.mock('./lane-load', () => ({ lane_load: { sample: sample_mock } }))

const { lane_ledger } = await import('./lane-ledger')
const { lane_ledger_write } = await import('./lane-ledger-write')
const { lane_measure_cli } = await import('./lane-measure-cli')
const { lane_stats } = await import('./lane-stats')
const { run_event_stream } = await import('#scripts/run/event/run-event-stream')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-measure-cli-test-'))
const NOW = Date.parse('2026-10-06T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const FAILURE = 1
const SINCE = '2026-10-06T00:00Z'
const SESSION_FILE = 'session.jsonl'
const GATE_STOP: LedgerEntry = { kind: 'stop', at: AT, issue: 1, reason: 'gate' }

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

interface TestContext {
	ledger_path: string
	events_path: string
	transcript_directories: Array<string>
	now_ms: number
}

function fresh_context(): TestContext {
	return {
		ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
		events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
		transcript_directories: [],
		now_ms: NOW,
	}
}

beforeEach(() => {
	sample_mock.mockReset().mockImplementation((at: string) => ({
		kind: 'load',
		at,
		load: 3,
		available_mb: 1024,
	}))
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
})

describe('lane_measure_cli.run — refusals', () => {
	it.each([
		[[]],
		[['measure']],
		[['sample', '--every', '0']],
		[['sample', '--every', 'soon']],
		[['sample', '--unknown']],
		[['stats']],
		[['stats', '--period', '-1']],
		[['value']],
		[['value', 'edit']],
		[['value', 'nope', '--since', SINCE]],
		[['value', 'edit', 'edit', '--since', SINCE]],
		[['value', 'edit', '--since', 'soon']],
		[['net']],
		[['net', '#4695']],
		[['net', '4695', '4696']],
	])('refuses %j', async (argv) => {
		await expect(lane_measure_cli.run(argv, fresh_context())).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(lane_measure_cli.USAGE)
	})

	it('names the net verb in the usage it prints', () => {
		expect(lane_measure_cli.USAGE).toContain('josh lane:net <issue>')
	})
})

describe('lane_measure_cli.run — sample', () => {
	it('appends one load sample stamped with the current instant', async () => {
		const context = fresh_context()

		await expect(lane_measure_cli.run(['sample'], context)).resolves.toBe(0)

		expect(sample_mock).toHaveBeenCalledWith(AT)
		expect(lane_ledger.read_entries(context.ledger_path)).toStrictEqual([
			{ kind: 'load', at: AT, load: 3, available_mb: 1024 },
		])
	})
})

describe('lane_measure_cli.run — stats', () => {
	it('prints the header and the row of the ledger period under the given limit', async () => {
		const context = fresh_context()

		lane_ledger_write.append(context.ledger_path, { kind: 'merge', at: AT, issue: 1 })

		await expect(
			lane_measure_cli.run(['stats', '--period', '2', '--limit', '6'], context),
		).resolves.toBe(0)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed.startsWith(lane_stats.header())).toBe(true)
		expect(printed).toContain('| 6 | 2 | 1 |')
	})

	// joshuafolkken/kit#3643: the same command prints where the period's lanes spent their time.
	it('prints the per-stage table under the row, unmeasured stages named as such', async () => {
		const context = fresh_context()
		const minute = 60_000

		lane_ledger_write.append(context.ledger_path, {
			kind: 'stage',
			at: AT,
			stage: 'review',
			elapsed_ms: minute,
		})

		await lane_measure_cli.run(['stats', '--period', '2'], context)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| review | 1.0 | 1.0 | 1 |')
		expect(printed).toContain('| ci-wait | not measured | not measured | 0 |')
	})

	// joshuafolkken/kit#3789: and, under that, how long a stopped ship waited for each stop reason.
	it('prints the per-stop-reason table last', async () => {
		const context = fresh_context()

		lane_ledger_write.append(context.ledger_path, GATE_STOP)

		await lane_measure_cli.run(['stats', '--period', '2'], context)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| stop | wait median (min) | wait max (min) | wait total (min) |')
		expect(printed).toContain('| gate | not measured | not measured | not measured | 0 | 1 |')
	})
})

// joshuafolkken/kit#3997: a park on the run's event stream ends a stop's wait.
describe('lane_measure_cli.run — stats reads the event stream', () => {
	it('reads the parks off the event stream the context names', async () => {
		const context = fresh_context()
		const parked_at = new Date(Date.parse(AT) + 60_000).toISOString()

		lane_ledger_write.append(context.ledger_path, GATE_STOP)
		run_event_stream.append(context.events_path, 'park', '#1 parked', parked_at)

		await lane_measure_cli.run(['stats', '--period', '2'], context)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| gate | 1.0 | 1.0 | 1.0 | 1 | 0 |')
	})

	// joshuafolkken/kit#4395: the same stream times the slot's cut, park and merge hand-offs.
	it('prints the hand-off gaps off the event stream the context names', async () => {
		const context = fresh_context()
		const resumed_at = new Date(Date.parse(AT) + 16_000).toISOString()

		run_event_stream.append(context.events_path, 'cut', '#1 cut (implementation)', AT)
		run_event_stream.append(context.events_path, 'resume', '#1 resumed', resumed_at)

		await lane_measure_cli.run(['stats', '--period', '2'], context)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| gap | count | median (s) | max (s) | not ended |')
		expect(printed).toContain('| cut → resume | 1 | 16 | 16 | 0 |')
	})
})

// joshuafolkken/kit#3995: and how long a free lane stayed empty, by why.
describe('lane_measure_cli.run — stats holds', () => {
	it('prints the per-hold-reason table', async () => {
		const context = fresh_context()

		lane_ledger_write.append(context.ledger_path, { kind: 'held', at: AT, reason: 'offer:wait' })

		await lane_measure_cli.run(['stats', '--period', '2'], context)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| held by | total (min) | median (min) | max (min) | holds |')
		expect(printed).toContain('| offer:wait | not measured | not measured | not measured | 1 | 1 |')
	})
})

// joshuafolkken/kit#4382: and how long each lane waited for the core budget.
describe('lane_measure_cli.run — stats core waits', () => {
	it('prints the per-lane core-wait table', async () => {
		const context = fresh_context()
		const wait = {
			kind: 'core-wait',
			at: AT,
			command: 'lint',
			waited_ms: 60_000,
			issue: 7,
		} as const

		lane_ledger_write.append(context.ledger_path, wait)

		await lane_measure_cli.run(['stats', '--period', '2'], context)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| lane | total (min) | median (min) | waits |')
		expect(printed).toContain('| 7 | 1.0 | 1.0 | 1 |')
	})
})

// joshuafolkken/kit#5138: and what each gate check claimed against the cores it used.
describe('lane_measure_cli.run — stats core claims', () => {
	it('prints the per-check claim-versus-measured table', async () => {
		const context = fresh_context()
		const claim = { requested: 2, granted: 2, waited_ms: 3000 }
		const check = { label: 'lint', elapsed_ms: 10_000, is_passed: true, cpu_ms: 15_000, claim }

		lane_ledger_write.append(context.ledger_path, {
			kind: 'gate',
			at: AT,
			elapsed_ms: 10_000,
			is_passed: true,
			checks: [check],
		})

		await lane_measure_cli.run(['stats', '--period', '2'], context)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| lint | 2.0 | 1 | 1.5 | 1.5 | 1.5 | 3.0 |')
	})
})

// joshuafolkken/kit#4064: and why round 2 ran or was skipped.
describe('lane_measure_cli.run — stats round 2', () => {
	it('prints the per-verdict-and-code table', async () => {
		const context = fresh_context()
		const decision = {
			kind: 'round-two',
			at: AT,
			issue: 1,
			verdict: 'skip',
			code: 'inert',
		} as const

		lane_ledger_write.append(context.ledger_path, decision)

		await lane_measure_cli.run(['stats', '--period', '2'], context)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| round 2 | code | decisions |')
		expect(printed).toContain('| skip | inert | 1 |')
	})
})

// joshuafolkken/kit#4418: and the lane sessions' transcript-side metrics, last.
describe('lane_measure_cli.run — stats transcripts', () => {
	it('prints the transcript table over the directories the context names', async () => {
		const context = fresh_context()
		const directory = mkdtempSync(path.join(scratch, 'transcripts-'))
		const block = { type: 'tool_use', id: 't', input: { command: 'pnpm josh gate' } }
		const line = { type: 'assistant', timestamp: AT, message: { content: [block] } }

		writeFileSync(path.join(directory, SESSION_FILE), JSON.stringify(line))
		await lane_measure_cli.run(['stats', '--period', '2'], {
			...context,
			transcript_directories: [directory],
		})

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| transcript metric | value |')
		expect(printed).toContain('| verification calls, solo | 1 |')
	})

	// joshuafolkken/kit#4887: the implement stage broken down by sub-stage, off the same transcripts.
	it('prints the implement sub-stage table', async () => {
		await lane_measure_cli.run(['stats', '--period', '2'], fresh_context())

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| implement sub-stage | lanes | median (min) | max (min) |')
	})
})

const PAUSED_ISSUE = 4216
const MS_PER_MINUTE = 60_000

function at_minute(offset: number): string {
	return new Date(NOW + offset * MS_PER_MINUTE).toISOString()
}

function lane_state(state: string, minute: number): string {
	return JSON.stringify({ kind: 'lane-state', at: at_minute(minute), issue: PAUSED_ISSUE, state })
}

// One lane session of `PAUSED_ISSUE`: a `Read` from 20 to 10 minutes before `NOW`, then its ship.
function paused_lane_transcript(): string {
	const directory = path.join(
		mkdtempSync(path.join(scratch, 'paused-')),
		`-kit-lanes-${String(PAUSED_ISSUE)}`,
	)
	const read = { type: 'tool_use', id: 'r', name: 'Read', input: {} }
	const ship = { type: 'tool_use', id: 's', name: 'Bash', input: { command: 'pnpm josh ship' } }
	const lines = [
		{ timestamp: at_minute(-20), message: { content: [read] } },
		{
			timestamp: at_minute(-10),
			message: { content: [{ type: 'tool_result', tool_use_id: 'r' }] },
		},
		{ timestamp: at_minute(-9), message: { content: [ship] } },
	]

	mkdirSync(directory)
	writeFileSync(
		path.join(directory, SESSION_FILE),
		lines.map((line) => JSON.stringify(line)).join('\n'),
	)

	return directory
}

// joshuafolkken/kit#5168: a ten-minute plan call that stood paused for eight of them.
describe('lane_measure_cli.run — stats paused lanes', () => {
	it("leaves a lane's paused time out of its implement sub-stages", async () => {
		const context = fresh_context()

		writeFileSync(
			context.ledger_path,
			[lane_state('paused', -19), lane_state('running', -11)].join('\n'),
		)
		await lane_measure_cli.run(['stats', '--period', '2'], {
			...context,
			transcript_directories: [paused_lane_transcript()],
		})

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toContain('| plan | 1 | 2.0 | 2.0 |')
	})
})

// One lane session that made one `Edit` taking 1.5 seconds, at `NOW`.
function edit_transcript(): string {
	const directory = mkdtempSync(path.join(scratch, 'value-'))
	const use = { type: 'tool_use', id: 'e', name: 'Edit', input: {} }
	const result = { type: 'tool_result', tool_use_id: 'e', content: 'ok' }
	const ended = new Date(NOW + 1500).toISOString()
	const lines = [
		{ timestamp: AT, message: { content: [use] } },
		{ timestamp: ended, message: { content: [result] } },
	]

	writeFileSync(
		path.join(directory, SESSION_FILE),
		lines.map((line) => JSON.stringify(line)).join('\n'),
	)

	return directory
}

// joshuafolkken/kit#4630: one measurement as one number on the last line, for a measurement declaration.
describe('lane_measure_cli.run — value', () => {
	const argv = ['value', 'edit', '--since', SINCE]

	it('prints the value alone, two decimals', async () => {
		const context = { ...fresh_context(), transcript_directories: [edit_transcript()] }

		await expect(lane_measure_cli.run(argv, context)).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith('1.50')
	})

	it('fails with no value when the period has no sample', async () => {
		await expect(lane_measure_cli.run(argv, fresh_context())).resolves.toBe(FAILURE)
		expect(console.info).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no sample since'))
	})
})
