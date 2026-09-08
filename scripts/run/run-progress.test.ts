import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_progress, type Observations } from './run-progress'

// joshuafolkken/kit#1520. The two properties that make this a progress report rather than a timer:
// it fires on silence measured from the last report, and the line carries observations that move.

const MINUTE = run_progress.MS_PER_MINUTE
const NOW = 10 * 60 * MINUTE
const DAY = 24 * 60 * MINUTE
const IN_PROGRESS = 'in-progress'

function observations(overrides: Partial<Observations> = {}): Observations {
	return {
		children: [{ issue: '1520', labels: [IN_PROGRESS], pr_state: 'open' }],
		lanes: [{ issue: '1520', state: 'open' }],
		load_average: 3.25,
		record_age_ms: 2 * MINUTE,
		...overrides,
	}
}

// The local half of the stamp, parsed back with the offset the line itself printed. Both round-trip
// assertions below read it the same way, so the shape lives here rather than in each of them. A line
// with no stamp parses to `NaN`, which fails the comparison rather than passing quietly.
function parse_stamp(line: string): number {
	const stamp = /at (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}[+-]\d{2}:\d{2}) \//u.exec(line)

	return Date.parse(`${stamp?.[1] ?? ''}T${stamp?.[2] ?? ''}`)
}

describe('is_due — the trigger is silence, not a clock', () => {
	it('withholds a line until the interval has passed since the last report', () => {
		expect(run_progress.is_due(NOW - 9 * MINUTE, NOW, 10 * MINUTE)).toBe(false)
	})

	it('reports once the interval has passed', () => {
		expect(run_progress.is_due(NOW - 11 * MINUTE, NOW, 10 * MINUTE)).toBe(true)
	})

	it('treats the exact interval as due, so a timer landing early costs no extra sleep', () => {
		expect(run_progress.is_due(NOW - 10 * MINUTE, NOW, 10 * MINUTE)).toBe(true)
	})

	it('never fires straight after a report, which is what a mark records', () => {
		expect(run_progress.is_due(NOW, NOW, 10 * MINUTE)).toBe(false)
	})
})

describe('minutes_from — one setting read, and never fatal', () => {
	it('keeps twenty minutes as the default, one to two reports per child', () => {
		expect(run_progress.DEFAULT_INTERVAL_MINUTES).toBe(20)
		expect(run_progress.DEFAULT_INTERVAL_MS).toBe(20 * MINUTE)
	})

	it('takes a positive number of minutes', () => {
		expect(run_progress.minutes_from('35')).toBe(35)
	})

	it('answers undefined rather than throwing, so a typo cannot end an unattended run', () => {
		for (const raw of [undefined, '', '  ', 'ten', '0', '-5', 'NaN']) {
			expect(run_progress.minutes_from(raw)).toBeUndefined()
		}
	})
})

describe('observation_key — what "unchanged" is measured over', () => {
	it('ignores the load average, which moves on every tick by construction', () => {
		const first = run_progress.observation_key(observations({ load_average: 1 }))
		const second = run_progress.observation_key(observations({ load_average: 9 }))

		expect(first).toBe(second)
	})

	it('ignores the record age, for the same reason', () => {
		const first = run_progress.observation_key(observations({ record_age_ms: MINUTE }))
		const second = run_progress.observation_key(observations({ record_age_ms: 40 * MINUTE }))

		expect(first).toBe(second)
	})

	it('moves when a child moves, which is the run itself moving', () => {
		const before = run_progress.observation_key(observations())
		const after = run_progress.observation_key(
			observations({ children: [{ issue: '1520', labels: [IN_PROGRESS], pr_state: 'merged' }] }),
		)

		expect(before).not.toBe(after)
	})

	it('moves when the lanes change', () => {
		const before = run_progress.observation_key(observations())
		const after = run_progress.observation_key(observations({ lanes: [] }))

		expect(before).not.toBe(after)
	})
})

describe('next_state — the unchanged-since clock', () => {
	it('starts the clock on the first tick', () => {
		expect(run_progress.next_state(undefined, 'a', NOW)).toEqual({
			key: 'a',
			unchanged_since_ms: NOW,
		})
	})

	it('carries the clock forward while the key is identical', () => {
		const first = run_progress.next_state(undefined, 'a', NOW)

		expect(run_progress.next_state(first, 'a', NOW + 30 * MINUTE).unchanged_since_ms).toBe(NOW)
	})

	it('restarts the clock the moment the key changes', () => {
		const first = run_progress.next_state(undefined, 'a', NOW)
		const second = run_progress.next_state(first, 'b', NOW + 30 * MINUTE)

		expect(second.unchanged_since_ms).toBe(NOW + 30 * MINUTE)
	})
})

const LINE = run_progress.format_line(observations(), {
	now_ms: NOW,
	quiet_since_ms: NOW - 12 * MINUTE,
	unchanged_since_ms: NOW - 3 * MINUTE,
})

describe('format_line — observations, never "still running"', () => {
	it('is one line, because it is relayed beside the run’s own output', () => {
		expect(LINE).not.toContain('\n')
	})

	it('names the child, its labels and whether a pull request exists', () => {
		expect(LINE).toContain('#1520')
		expect(LINE).toContain(IN_PROGRESS)
		expect(LINE).toContain('PR:open')
	})

	it('carries the lanes, the load average and how long the record has been silent', () => {
		expect(LINE).toContain('lanes 1520:open')
		expect(LINE).toContain('load 3.3')
		expect(LINE).toContain('record +2m')
	})

	it('carries both elapsed figures, which is what makes it not a bare heartbeat', () => {
		expect(LINE).toContain('quiet 12m')
		expect(LINE).toContain('unchanged 3m')
	})

	it('reports no verification result, because it reads none', () => {
		expect(LINE).not.toMatch(/gate|CI|check|green|pass/iu)
	})
})

// joshuafolkken/kit#1560. A suspended session resumed, read its own `quiet 11m` as if no time had
// passed, and concluded the machine's clock was broken when it was correct to the second.
describe('format_line — when the observation was taken', () => {
	it('says when it was observed, beside how long the silence had run', () => {
		expect(LINE).toContain('1970-01-01T10:00Z')
		expect(LINE).toContain('quiet 12m')
	})

	it('carries the date, because the run that needed this was suspended across one', () => {
		const next_day = run_progress.format_line(observations(), {
			now_ms: NOW + DAY,
			quiet_since_ms: NOW,
			unchanged_since_ms: NOW,
		})

		expect(next_day).toContain('1970-01-02T10:00Z')
	})

	// The UTC half stays an exact pin: `NOW` is ten hours after the epoch, so a formatter that printed
	// the reader's own zone *instead* would show another hour on any machine that is not on UTC. The
	// `Z` is what stops a reader having to guess which of the two halves is which.
	it('marks the zone, so a reader in another one is not left guessing', () => {
		expect(LINE).toMatch(/ \/ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z /u)
	})

	// The local half is what a person can act on without converting anything, and it leads for that
	// reason. It cannot be pinned to a literal — the value depends on the machine's zone — so what is
	// asserted is its shape and its offset, both of which hold wherever the suite runs.
	it('leads with the local clock, and names the offset that places it', () => {
		expect(LINE).toMatch(/ at \d{4}-\d{2}-\d{2} \d{2}:\d{2}[+-]\d{2}:\d{2} \/ /u)
	})

	// The two halves have to be the same instant, or the line is worse than one of them alone. Parsing
	// the local half back with its own printed offset is what checks that, and it stays deterministic
	// on every machine because the offset it is read with is the one the line just printed.
	it('prints one instant twice, not two clocks that disagree', () => {
		expect(parse_stamp(LINE)).toBe(Math.floor(NOW / MINUTE) * MINUTE)
	})
})

// A zone's offset is not always a whole number of minutes, and `NOW` is an instant in 1970 —
// `Asia/Kathmandu` was `+05:41:16` then, which answers `-341.2666…`. Two separate things break there,
// and the machine running the suite is the only reason neither is normally seen: the minutes field
// printed `41.26666666666667`, and the local clock read off `getHours` / `getMinutes` truncated the
// seconds the offset beside it rounded, so the stamp no longer named the instant it was taken at.
describe('format_line — a zone whose offset is not whole minutes', () => {
	const KATHMANDU_1970_MINUTES = -341.2666666666667

	function line_in_kathmandu(): string {
		vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(KATHMANDU_1970_MINUTES)

		return run_progress.format_line(observations(), {
			now_ms: NOW,
			quiet_since_ms: NOW,
			unchanged_since_ms: NOW,
		})
	}

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('rounds the offset rather than printing a fraction of a minute', () => {
		expect(line_in_kathmandu()).toContain('+05:41 /')
	})

	it('still names the instant it was taken at, the clock and the offset agreeing', () => {
		expect(parse_stamp(line_in_kathmandu())).toBe(NOW)
	})
})

describe('format_line — what it says when it has nothing to say', () => {
	it('says an unread record is unread rather than inventing an age for it', () => {
		const unread = run_progress.format_line(observations({ record_age_ms: undefined }), {
			now_ms: NOW,
			quiet_since_ms: NOW - MINUTE,
			unchanged_since_ms: NOW,
		})

		expect(unread).toContain('record unread')
	})

	it('says so when no lane is open', () => {
		expect(run_progress.format_lanes([])).toBe('none')
	})

	it('says so when a child carries no label at all', () => {
		expect(run_progress.format_child({ issue: '9', labels: [], pr_state: 'none' })).toBe(
			'#9 (no labels) PR:none',
		)
	})
})
