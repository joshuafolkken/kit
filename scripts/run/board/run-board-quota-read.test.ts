import { mkdtempSync } from 'node:fs'
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_quota_read } from './run-board-quota-read'

const { FIVE_HOURS_MINUTES, SEVEN_DAYS_MINUTES } = run_board_quota_read
const { claude_files, claude_windows, codex_files, codex_windows } = run_board_quota_read
const RESET_S = 1_761_730_000
const RESET_MS = RESET_S * 1000
const NOW_MS = Date.parse('2026-10-29T12:00:00')
const NONE = 'null'

function claude_line(five_hour: number, seven_day?: number): string {
	const windows = {
		five_hour: { utilization: five_hour, resetsAt: RESET_S },
		...(seven_day !== undefined && { seven_day: { utilization: seven_day, resetsAt: RESET_S } }),
	}
	const info = { status: 'allowed', unifiedWindows: windows }

	return JSON.stringify({ type: 'rate_limit_event', rate_limit_info: info, session_id: 's' })
}

// A rollout's `token_count` line as Codex writes it, `rate_limits` given as its JSON text.
function codex_line(rate_limits: string): string {
	const head = '{"timestamp":"2026-10-29T03:00:00Z","type":"event_msg"'

	return `${head},"payload":{"type":"token_count","rate_limits":${rate_limits}}}`
}

function codex_window(used_percent: number, window_minutes: number): string {
	return JSON.stringify({ used_percent, window_minutes, resets_at: RESET_S })
}

// A tail as long as asked, so the file reads as longer than it.
function full_tail(bytes: number): string {
	return 'x'.repeat(bytes)
}

async function written(file: string, seconds: number): Promise<string> {
	await mkdir(path.dirname(file), { recursive: true })
	await writeFile(file, '')
	await utimes(file, seconds, seconds)

	return file
}

describe('run_board_quota_read.claude_windows', () => {
	it('reads the last rate_limit_event, both windows in percent', () => {
		const text = [claude_line(0.1, 0.2), '{"type":"assistant"}', claude_line(0.42, 0.68)].join('\n')

		expect(claude_windows(text)).toEqual([
			{ minutes: FIVE_HOURS_MINUTES, used_percent: 42, resets_ms: RESET_MS },
			{ minutes: SEVEN_DAYS_MINUTES, used_percent: 68, resets_ms: RESET_MS },
		])
	})

	it('reads a window the event leaves out as none, and a broken or cut line as no event', () => {
		expect(claude_windows(claude_line(0.5))).toHaveLength(1)
		expect(claude_windows(`${claude_line(0.5).slice(10)}\n{"type":"rate_limit_event"`)).toEqual([])
	})
})

describe('run_board_quota_read.codex_windows', () => {
	it('reads the last non-null rate_limits, primary and secondary', () => {
		const limits = `{"primary":${codex_window(12, 300)},"secondary":${codex_window(45, 10_080)}}`
		const text = [codex_line(limits), codex_line(NONE)].join('\n')

		expect(codex_windows(text)).toEqual([
			{ minutes: 300, used_percent: 12, resets_ms: RESET_MS },
			{ minutes: 10_080, used_percent: 45, resets_ms: RESET_MS },
		])
	})

	it('reads a free plan: one 30-day primary and no secondary', () => {
		const text = codex_line(`{"primary":${codex_window(7, 43_200)},"secondary":${NONE}}`)

		expect(codex_windows(text)).toEqual([{ minutes: 43_200, used_percent: 7, resets_ms: RESET_MS }])
	})

	it('reads a file holding only null rate_limits or broken lines as none', () => {
		expect(codex_windows(`${codex_line(NONE)}\n{"rate_limits":{broken`)).toEqual([])
	})
})

// A lane log runs megabytes of tool output past its last `rate_limit_event`.
describe('run_board_quota_read.windows_in', () => {
	const { TAIL_BYTES, TAIL_LIMIT_BYTES, windows_in } = run_board_quota_read

	it('widens the tail until it holds a reading, and reads no wider', async () => {
		const tail_of = vi.fn(async (bytes: number) =>
			bytes > TAIL_BYTES ? claude_line(42) : full_tail(bytes),
		)

		expect(await windows_in(tail_of, claude_windows)).toHaveLength(1)
		expect(tail_of.mock.calls.map(([bytes]) => bytes)).toEqual([TAIL_BYTES, TAIL_BYTES * 8])
	})

	it('stops at the limit where no tail holds a reading', async () => {
		const tail_of = vi.fn(async (bytes: number) => full_tail(bytes))

		expect(await windows_in(tail_of, claude_windows)).toEqual([])
		expect(tail_of).toHaveBeenLastCalledWith(TAIL_LIMIT_BYTES)
	})

	it('reads no wider than a tail shorter than asked, the whole file', async () => {
		const tail_of = vi.fn(async () => 'short')

		expect(await windows_in(tail_of, claude_windows)).toEqual([])
		expect(tail_of).toHaveBeenCalledTimes(1)
	})
})

describe('run_board_quota_read files', () => {
	let root = ''

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'quota-read-'))
	})

	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	function lane_log(name: number): string {
		return path.join(root, `josh-lane-dispatch-${String(name)}.log`)
	}

	it('finds the three newest lane logs newest first, and none in a missing directory', async () => {
		await written(lane_log(1), 100)
		const older = await written(lane_log(2), 200)
		const newer = await written(lane_log(3), 300)
		const newest = await written(lane_log(4), 400)

		await written(path.join(root, 'josh-other-5.log'), 500)
		const found = await claude_files(root)

		expect(found.map((file) => file.path)).toEqual([newest, newer, older])
		expect(await claude_files(path.join(root, 'missing'))).toEqual([])
	})

	it('finds the newest rollout files of today and yesterday, never older days', async () => {
		const sessions = path.join(root, 'sessions', '2026', '10')
		const yesterday = await written(path.join(sessions, '28', 'rollout-a.jsonl'), 200)
		const today = await written(path.join(sessions, '29', 'rollout-c.jsonl'), 100)

		await written(path.join(sessions, '27', 'rollout-b.jsonl'), 300)
		const found = await codex_files(NOW_MS, root)

		expect(found.map((file) => file.path)).toEqual([yesterday, today])
		expect(await codex_files(NOW_MS, path.join(root, 'missing'))).toEqual([])
	})
})
