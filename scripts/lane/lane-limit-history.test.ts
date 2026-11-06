import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LimitChoice } from './lane-capacity'
import type { LedgerEntry } from './lane-ledger'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6139: every lane-limit change is a ledger line, and `lane:stats` labels a period the
// limit moved in with each limit it held rather than the one it reads now.

const lane_limit_mock = vi.hoisted(() => vi.fn())
const environment_limit_mock = vi.hoisted(() => vi.fn())
const write_launch_mock = vi.hoisted(() => vi.fn())

vi.mock('./lane-capacity', () => ({
	lane_capacity: { lane_limit: lane_limit_mock, environment_limit: environment_limit_mock },
}))
vi.mock('./lane-limit-override', () => ({
	lane_limit_override: { write_launch: write_launch_mock },
}))

const { lane_ledger } = await import('./lane-ledger')
const { lane_limit_history } = await import('./lane-limit-history')
const { lane_ledger_write } = await import('./lane-ledger-write')
const { lane_measure_cli } = await import('./lane-measure-cli')

const scratch = make_directory('lane-limit-history-test-')
const CURRENT_LIMIT = 4
const LAUNCH_LIMIT = 3
const PROBLEM: LimitChoice = { kind: 'problem', problem: 'JOSH_LANE_LIMIT is not a number' }
const WINDOW = {
	since_ms: Date.parse('2026-11-02T16:00:00.000Z'),
	until_ms: Date.parse('2026-11-03T16:00:00.000Z'),
}

// Before the window, and inside it at the switch #6139 measured.
const BEFORE = '2026-11-02T10:00:00.000Z'
const SWITCH = '2026-11-03T03:51:00.000Z'

function limit_at(at: string, limit: number): LedgerEntry {
	return { kind: 'limit', at, limit }
}

beforeEach(() => {
	lane_limit_mock.mockReset().mockResolvedValue({ kind: 'limit', limit: CURRENT_LIMIT })
	environment_limit_mock.mockReset().mockReturnValue({ kind: 'limit', limit: LAUNCH_LIMIT })
	write_launch_mock.mockReset().mockResolvedValue(true)
})

// joshuafolkken/kit#6166: the start limit is the environment's, kept on the carry record as well.
describe('lane_limit_history.record_launch', () => {
	it('keeps the environment limit on the run and appends it', async () => {
		const ledger = path.join(scratch, 'launch.jsonl')

		await lane_limit_history.record_launch(ledger)

		expect(write_launch_mock).toHaveBeenCalledWith(LAUNCH_LIMIT)
		expect(lane_ledger.read_entries(ledger)).toMatchObject([{ kind: 'limit', limit: LAUNCH_LIMIT }])
	})

	it('keeps and appends nothing when the environment limit cannot be read', async () => {
		const ledger = path.join(scratch, 'launch-problem.jsonl')

		environment_limit_mock.mockReturnValue(PROBLEM)
		await lane_limit_history.record_launch(ledger)

		expect(write_launch_mock).not.toHaveBeenCalled()
		expect(lane_ledger.read_entries(ledger)).toStrictEqual([])
	})
})

describe('lane_limit_history.record_current', () => {
	it('appends the limit this process reads, stamped now', async () => {
		const ledger = path.join(scratch, 'record.jsonl')

		await lane_limit_history.record_current(ledger)

		const entries = lane_ledger.read_entries(ledger)

		expect(entries).toHaveLength(1)
		expect(entries[0]).toMatchObject({ kind: 'limit', limit: CURRENT_LIMIT })
	})

	it('appends nothing when the limit cannot be read', async () => {
		const ledger = path.join(scratch, 'problem.jsonl')

		lane_limit_mock.mockResolvedValue(PROBLEM)
		await lane_limit_history.record_current(ledger)

		expect(lane_ledger.read_entries(ledger)).toStrictEqual([])
	})
})

describe('lane_limit_history.label', () => {
	it('labels a window the limit changed in with the limit in force at its start and each change', async () => {
		const entries = [
			limit_at('2026-11-01T00:00:00.000Z', 2),
			limit_at(BEFORE, 3),
			limit_at(SWITCH, 4),
		]

		await expect(lane_limit_history.label(undefined, entries, WINDOW)).resolves.toBe('3→4')
	})

	it('drops a repeat, so a run restarted under the same limit labels one value', async () => {
		const entries = [limit_at(BEFORE, 3), limit_at(SWITCH, 3)]

		await expect(lane_limit_history.label(undefined, entries, WINDOW)).resolves.toBe('3')
	})

	it('ignores a limit written after the window closes', async () => {
		const entries = [limit_at(BEFORE, 3), limit_at('2026-11-04T00:00:00.000Z', 5)]

		await expect(lane_limit_history.label(undefined, entries, WINDOW)).resolves.toBe('3')
	})

	it('falls back to the limit this process reads when the ledger holds none', async () => {
		await expect(lane_limit_history.label(undefined, [], WINDOW)).resolves.toBe('4')
	})

	it('falls back to the missing mark when the limit cannot be read either', async () => {
		lane_limit_mock.mockResolvedValue(PROBLEM)

		await expect(lane_limit_history.label(undefined, [], WINDOW)).resolves.toBe('—')
	})

	it('takes --limit over the history', async () => {
		const entries = [limit_at(SWITCH, 3)]

		await expect(lane_limit_history.label('6', entries, WINDOW)).resolves.toBe('6')
	})
})

describe('lane:stats labels its row with the limit history', () => {
	it('prints 3→4 in the JOSH_LANE_LIMIT cell of a day the limit moved in', async () => {
		const ledger_path = path.join(scratch, 'stats.jsonl')
		const context = {
			ledger_path,
			events_path: path.join(scratch, 'stats-events.jsonl'),
			transcript_directories: [],
			now_ms: WINDOW.until_ms,
		}
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		lane_ledger_write.append(ledger_path, limit_at(BEFORE, 3))
		lane_ledger_write.append(ledger_path, limit_at(SWITCH, CURRENT_LIMIT))
		await lane_measure_cli.run(['stats', '--period', '1'], context)

		expect(String(info.mock.calls[0]?.[0])).toContain('| 3→4 | 1 |')
	})
})
