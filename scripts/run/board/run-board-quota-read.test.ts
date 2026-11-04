import { describe, expect, it, vi } from 'vitest'
import { run_board_quota_read } from './run-board-quota-read'

const { FIVE_HOURS_MINUTES, SEVEN_DAYS_MINUTES } = run_board_quota_read
const { claude_reading, codex_reading } = run_board_quota_read
const RESET_S = 1_761_730_000
const RESET_MS = RESET_S * 1000
const NONE = 'null'
const TAKEN = '2026-10-29T03:00:00Z'
const TAKEN_MS = Date.parse(TAKEN)
const EARLIER = '2026-10-28T03:00:00Z'
// External logs can contain null timestamps; the parser must retain their windows.
const NULL_TIME: unknown = JSON.parse(NONE)
const INVALID_TIME = 'invalid'
const UNKNOWN_TIME_TEST = 'keeps windows with unknown time for %s'
const ASSISTANT = '{"type":"assistant"}'

describe('run_board_quota_read.codex_lane', () => {
	it.each(['/work/.kit-lanes/6375', '/work/.kit-lanes/6375/scripts'])(
		'reads the lane of %s',
		(cwd) => {
			const head = JSON.stringify({ type: 'session_meta', payload: { cwd } })

			expect(run_board_quota_read.codex_lane(`${head}\n${ASSISTANT}`, '')).toBe('6375')
		},
	)

	it.each(['/work/kit', undefined, NULL_TIME, 123])(
		'reads an absent or outside cwd as none: %s',
		(cwd) => {
			const head = JSON.stringify({ type: 'session_meta', payload: { cwd } })

			expect(run_board_quota_read.codex_lane(head, '')).toBeUndefined()
		},
	)

	it.each([ASSISTANT, '', '{"type":"session_meta"'])(
		'reads missing metadata as none: %s',
		(head) => {
			expect(run_board_quota_read.codex_lane(head, '')).toBeUndefined()
		},
	)
})

function claude_line(five_hour: number, seven_day?: number, timestamp?: unknown): string {
	const windows = {
		five_hour: { utilization: five_hour, resetsAt: RESET_S },
		...(seven_day !== undefined && { seven_day: { utilization: seven_day, resetsAt: RESET_S } }),
	}
	const info = { status: 'allowed', unifiedWindows: windows }

	return JSON.stringify({ type: 'rate_limit_event', rate_limit_info: info, timestamp })
}

// A stream-json line Claude Code stamps, as its `assistant` and `user` lines are.
function timed(timestamp: string): string {
	return JSON.stringify({ type: 'assistant', timestamp })
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

// Claude Code's `rate_limit_event` carries no `timestamp` (joshuafolkken/kit#5509).
describe('run_board_quota_read.claude_reading time from nearby lines', () => {
	const HEADER = `=== ${EARLIER} · started by process 1 · claude ===`
	const LATER = '{"type":"user","timestamp":"2026-10-30T03:00:00Z"}'

	it('reads the nearest timed line before a timestamp-less event', () => {
		const text = [HEADER, timed(EARLIER), timed(TAKEN), ASSISTANT, claude_line(0.42), LATER]

		expect(claude_reading(text.join('\n'))?.taken_ms).toBe(TAKEN_MS)
	})

	it("reads the launcher header's time where no JSON line before the event is timed", () => {
		const text = ['', HEADER, ASSISTANT, claude_line(0.42), LATER].join('\n')

		expect(claude_reading(text)?.taken_ms).toBe(Date.parse(EARLIER))
	})

	it('keeps the time unknown where nothing before the event is timed', () => {
		const text = [ASSISTANT, claude_line(0.42), LATER, HEADER].join('\n')

		expect(claude_reading(text)?.taken_ms).toBeUndefined()
	})

	it("prefers the event's own timestamp over the lines before it", () => {
		const text = [timed(EARLIER), claude_line(0.42, undefined, TAKEN)].join('\n')

		expect(claude_reading(text)?.taken_ms).toBe(TAKEN_MS)
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

describe('run_board_quota_read head readings', () => {
	const { claude_heads, codex_heads } = run_board_quota_read

	it('reads every event of a file head oldest first, past a line its byte limit cut', () => {
		const text = [claude_line(0.1), claude_line(0.42), claude_line(0.5).slice(0, 20)].join('\n')
		const rollout = [codex_line(NONE), primary_line(3), primary_line(9)].join('\n')
		const used = claude_heads(text).map((reading) => reading.windows[0]?.used_percent)

		expect(used).toEqual([10, 42])
		expect(codex_heads(rollout)[0]?.windows).toEqual([
			{ minutes: 300, used_percent: 3, resets_ms: RESET_MS },
		])
		expect(claude_heads(ASSISTANT)).toEqual([])
	})

	it('times each Claude head event by the nearest timed line before it, as a tail is', () => {
		const text = [timed(EARLIER), claude_line(0.1), timed(TAKEN), claude_line(0.42)].join('\n')

		expect(claude_heads(text).map((reading) => reading.taken_ms)).toEqual([
			Date.parse(EARLIER),
			TAKEN_MS,
		])
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
