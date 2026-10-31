import { mkdtempSync } from 'node:fs'
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_quota_read } from './run-board-quota-read'

const { FIVE_HOURS_MINUTES, SEVEN_DAYS_MINUTES } = run_board_quota_read
const { claude_files, claude_reading, codex_files, codex_reading } = run_board_quota_read
const RESET_S = 1_761_730_000
const RESET_MS = RESET_S * 1000
const NOW_MS = Date.parse('2026-10-29T12:00:00')
const NONE = 'null'
const TAKEN = '2026-10-29T03:00:00Z'
const TAKEN_MS = Date.parse(TAKEN)
const EARLIER = '2026-10-28T03:00:00Z'
// External logs can contain null timestamps; the parser must retain their windows.
const NULL_TIME: unknown = JSON.parse(NONE)
const INVALID_TIME = 'invalid'
const UNKNOWN_TIME_TEST = 'keeps windows with unknown time for %s'
const ASSISTANT = '{"type":"assistant"}'

function claude_line(five_hour: number, seven_day?: number, timestamp?: unknown): string {
	const windows = {
		five_hour: { utilization: five_hour, resetsAt: RESET_S },
		...(seven_day !== undefined && { seven_day: { utilization: seven_day, resetsAt: RESET_S } }),
	}
	const info = { status: 'allowed', unifiedWindows: windows }

	return JSON.stringify({ type: 'rate_limit_event', rate_limit_info: info, timestamp })
}

// A rollout's `token_count` line as Codex writes it, `rate_limits` given as its JSON text.
function codex_line(rate_limits: string, timestamp: unknown = TAKEN): string {
	const head = JSON.stringify({ timestamp, type: 'event_msg' }).slice(0, -1)

	return `${head},"payload":{"type":"token_count","rate_limits":${rate_limits}}}`
}

function codex_window(used_percent: number, window_minutes: number): string {
	return JSON.stringify({ used_percent, window_minutes, resets_at: RESET_S })
}

function primary_line(used_percent: number): string {
	return codex_line(`{"primary":${codex_window(used_percent, 300)}}`)
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

describe('run_board_quota_read.claude_reading', () => {
	it('reads the last rate_limit_event, both windows in percent', () => {
		const text = [claude_line(0.1, 0.2), ASSISTANT, claude_line(0.42, 0.68)].join('\n')

		expect(claude_reading(text)).toEqual({
			windows: [
				{ minutes: FIVE_HOURS_MINUTES, used_percent: 42, resets_ms: RESET_MS },
				{ minutes: SEVEN_DAYS_MINUTES, used_percent: 68, resets_ms: RESET_MS },
			],
			taken_ms: undefined,
		})
	})

	it('reads a window in whole percents, with no floating-point remainder', () => {
		expect(claude_reading(claude_line(0.07))?.windows[0]?.used_percent).toBe(7)
	})

	it('reads a window the event leaves out as none, and a broken or cut line as no event', () => {
		expect(claude_reading(claude_line(0.5))?.windows).toHaveLength(1)
		expect(
			claude_reading(`${claude_line(0.5).slice(10)}\n{"type":"rate_limit_event"`),
		).toBeUndefined()
	})

	it('keeps the timestamp of the last usage event across unrelated later lines', () => {
		const text = [
			claude_line(0.1, undefined, EARLIER),
			claude_line(0.42, undefined, TAKEN),
			'{"type":"assistant","timestamp":"2026-10-30T03:00:00Z"}',
		].join('\n')

		expect(claude_reading(text)?.taken_ms).toBe(TAKEN_MS)
	})

	it.each([undefined, NULL_TIME, INVALID_TIME, 123])(UNKNOWN_TIME_TEST, (timestamp) => {
		const parsed = claude_reading(claude_line(0.42, undefined, timestamp))

		expect(parsed?.windows).toHaveLength(1)
		expect(parsed?.taken_ms).toBeUndefined()
	})
})

describe('run_board_quota_read.codex_reading', () => {
	it('reads the last non-null rate_limits, primary and secondary', () => {
		const limits = `{"primary":${codex_window(12, 300)},"secondary":${codex_window(45, 10_080)}}`
		const text = [codex_line(limits), codex_line(NONE)].join('\n')

		expect(codex_reading(text)).toEqual({
			windows: [
				{ minutes: 300, used_percent: 12, resets_ms: RESET_MS },
				{ minutes: 10_080, used_percent: 45, resets_ms: RESET_MS },
			],
			taken_ms: TAKEN_MS,
		})
	})

	it('reads a free plan: one 30-day primary and no secondary', () => {
		const text = codex_line(`{"primary":${codex_window(7, 43_200)},"secondary":${NONE}}`)

		expect(codex_reading(text)?.windows).toEqual([
			{ minutes: 43_200, used_percent: 7, resets_ms: RESET_MS },
		])
	})

	it('reads a file holding only null rate_limits or broken lines as none', () => {
		expect(codex_reading(`${codex_line(NONE)}\n{"rate_limits":{broken`)).toBeUndefined()
	})
})

describe('run_board_quota_read.codex_reading time', () => {
	it('pairs time and values from the same latest event, ignoring unrelated append and null limits', () => {
		const limits = `{"primary":${codex_window(42, 300)}}`
		const text = [
			codex_line(limits, EARLIER),
			codex_line(limits),
			codex_line(NONE, '2026-10-30T03:00:00Z'),
			'{"timestamp":"2026-10-30T04:00:00Z","payload":{"type":"message"}}',
		].join('\n')

		expect(codex_reading(text)?.taken_ms).toBe(TAKEN_MS)
	})

	it.each([NULL_TIME, INVALID_TIME, 123])(UNKNOWN_TIME_TEST, (timestamp) => {
		const parsed = codex_reading(codex_line(`{"primary":${codex_window(42, 300)}}`, timestamp))

		expect(parsed?.windows).toHaveLength(1)
		expect(parsed?.taken_ms).toBeUndefined()
	})

	it('keeps a timestamp-less legacy event unknown instead of inheriting an older time', () => {
		const limits = `{"primary":${codex_window(42, 300)}}`
		const legacy = `{"payload":{"rate_limits":${limits}}}`

		expect(codex_reading(`${codex_line(limits)}\n${legacy}`)?.taken_ms).toBeUndefined()
	})
})

describe('run_board_quota_read first readings', () => {
	const { claude_first, codex_first } = run_board_quota_read

	it("reads a file head's first event, past a line its byte limit cut", () => {
		const text = [claude_line(0.1), claude_line(0.42), claude_line(0.5).slice(0, 20)].join('\n')
		const rollout = [codex_line(NONE), primary_line(3), primary_line(9)].join('\n')

		expect(claude_first(text)?.windows[0]?.used_percent).toBe(10)
		expect(codex_first(rollout)?.windows).toEqual([
			{ minutes: 300, used_percent: 3, resets_ms: RESET_MS },
		])
		expect(claude_first(ASSISTANT)).toBeUndefined()
	})
})

// A lane log runs megabytes of tool output past its last `rate_limit_event`.
describe('run_board_quota_read.reading_in', () => {
	const { TAIL_BYTES, TAIL_LIMIT_BYTES, reading_in } = run_board_quota_read

	it('widens the tail until it holds a reading, and reads no wider', async () => {
		const tail_of = vi.fn(async (bytes: number) =>
			bytes > TAIL_BYTES ? claude_line(0.42, undefined, TAKEN) : full_tail(bytes),
		)

		expect(await reading_in(tail_of, claude_reading)).toMatchObject({ taken_ms: TAKEN_MS })
		expect(tail_of.mock.calls.map(([bytes]) => bytes)).toEqual([TAIL_BYTES, TAIL_BYTES * 8])
	})

	it('stops at the limit where no tail holds a reading', async () => {
		const tail_of = vi.fn(async (bytes: number) => full_tail(bytes))

		expect(await reading_in(tail_of, claude_reading)).toBeUndefined()
		expect(tail_of).toHaveBeenLastCalledWith(TAIL_LIMIT_BYTES)
	})

	it('reads no wider than a tail shorter than asked, the whole file', async () => {
		const tail_of = vi.fn(async () => 'short')

		expect(await reading_in(tail_of, claude_reading)).toBeUndefined()
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

describe('run_board_quota_read.read_head', () => {
	it("reads a file's first bytes, and the whole of a shorter one", async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'quota-head-'))
		const file = path.join(root, 'head.log')

		await writeFile(file, 'abcdef')

		expect(await run_board_quota_read.read_head(file, 3)).toBe('abc')
		expect(await run_board_quota_read.read_head(file)).toBe('abcdef')
		await rm(root, { recursive: true, force: true })
	})
})
