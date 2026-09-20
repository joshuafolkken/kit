import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_progress_clock } from './run-progress-clock'

// joshuafolkken/kit#1821: the watcher's own liveness record, kept apart from the report clock. The
// watcher writes it, reads it every tick, and stops when it is gone; `josh followup` removes it at the
// merge. The read/write is `stamp_file` and the record is presence-only, so these drive it through a
// real temp file rather than a mock.
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-life-record-'))

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('the watcher liveness record', () => {
	it('reads as ended before the watcher has begun', () => {
		const target = path.join(TEMPORARY, 'absent.json')

		expect(run_progress_clock.is_life_ended(target)).toBe(true)
	})

	it('reads as alive once the watcher has begun, and ended once it is removed', () => {
		const target = path.join(TEMPORARY, 'alive.json')

		run_progress_clock.begin_life(target)
		expect(run_progress_clock.is_life_ended(target)).toBe(false)

		run_progress_clock.end_life(target)
		expect(run_progress_clock.is_life_ended(target)).toBe(true)
	})

	// A `--wait` the caller restarts must cleanly replace a record an earlier one left, so beginning
	// twice is a refresh rather than an error.
	it('refreshes an existing record rather than failing', () => {
		const target = path.join(TEMPORARY, 'refresh.json')

		run_progress_clock.begin_life(target)
		run_progress_clock.begin_life(target)

		expect(run_progress_clock.is_life_ended(target)).toBe(false)
	})

	// Removing an absent record is what `josh followup` does when no watcher ran, so it must be safe.
	it('is safe to end a record that was never begun', () => {
		const target = path.join(TEMPORARY, 'never.json')

		expect(() => {
			run_progress_clock.end_life(target)
		}).not.toThrow()
	})
})

describe('ping_life and is_life_fresh — staleness detection (joshuafolkken/kit#2113)', () => {
	it('is_life_fresh returns false for an absent record', () => {
		const target = path.join(TEMPORARY, 'fresh-absent.json')

		expect(run_progress_clock.is_life_fresh(target, 60_000)).toBe(false)
	})

	it('is_life_fresh returns false for an old-format record without pinged_at', () => {
		const target = path.join(TEMPORARY, 'fresh-old.json')

		writeFileSync(target, JSON.stringify({ alive: true }))

		expect(run_progress_clock.is_life_fresh(target, 60_000)).toBe(false)
	})

	it('is_life_fresh returns true right after ping_life', () => {
		const target = path.join(TEMPORARY, 'fresh-pinged.json')

		run_progress_clock.ping_life(target)

		expect(run_progress_clock.is_life_fresh(target, 60_000)).toBe(true)
	})

	it('is_life_fresh returns false after the threshold has elapsed', () => {
		const target = path.join(TEMPORARY, 'fresh-stale.json')

		run_progress_clock.ping_life(target)

		// is_life_fresh with a threshold of 0 ms always returns false
		expect(run_progress_clock.is_life_fresh(target, 0)).toBe(false)
	})

	// begin_life now also sets pinged_at, so the liveness record is fresh from the first write.
	it('begin_life writes a fresh pinged_at timestamp', () => {
		const target = path.join(TEMPORARY, 'fresh-begin.json')

		run_progress_clock.begin_life(target)

		expect(run_progress_clock.is_life_fresh(target, 60_000)).toBe(true)
	})
})

describe('the liveness record is a separate file from the report clock', () => {
	// Removing the liveness record must not disturb the report clock the early-heartbeat guard reads,
	// so the two key on the same directory through different prefixes.
	it('keys on the same directory but resolves a different file', () => {
		const directory = '/scratch/.git'

		expect(run_progress_clock.life_target_of(directory)).not.toBe(
			run_progress_clock.stamp_target_of(directory),
		)
	})

	it('builds its path from the life prefix', () => {
		expect(run_progress_clock.LIFE_PREFIX).toBe('josh-run-progress-life-')
	})
})

// joshuafolkken/kit#1910: a headless `backlogrun` parent woken after a cut prints its progress only to
// its own transcript, so the clock also carries the last heartbeat line for `josh run:wake --list` to
// relay verbatim. The relayed value being identical to the watcher's own output is the acceptance
// criterion, and it is pinned by the round-trip here.
describe('the report clock also carries the last heartbeat line', () => {
	const LINE =
		'⏳ at 2026-09-13 15:30+09:00 / 06:30Z · quiet 3m · #1904 in-progress PR:open · lanes none · load 1.0 · record unread · unchanged 3m · next later'
	const WHEN = Date.parse('2026-09-13T06:30:00.000Z')

	it('persists a heartbeat line and reads it back unchanged', () => {
		const target = path.join(TEMPORARY, 'line.json')

		run_progress_clock.mark(target, WHEN, LINE)

		expect(run_progress_clock.read_last_line(target)).toBe(LINE)
	})

	// A bare `--mark` moves the clock on a run's real report without a heartbeat line; blanking the last
	// one there would leave `--list` empty on every real report, so it is kept.
	it('keeps the last line when a bare mark only moves the clock', () => {
		const target = path.join(TEMPORARY, 'kept.json')

		run_progress_clock.mark(target, WHEN, LINE)
		run_progress_clock.mark(target, WHEN)

		expect(run_progress_clock.read_last_line(target)).toBe(LINE)
	})

	// An absent record and one written before this field existed both carry no line.
	it('reads no line from an absent or line-less record', () => {
		const target = path.join(TEMPORARY, 'no-line.json')

		expect(run_progress_clock.read_last_line(target)).toBeUndefined()

		run_progress_clock.mark(target, WHEN)
		expect(run_progress_clock.read_last_line(target)).toBeUndefined()
	})
})

// joshuafolkken/kit#2156: the report clock also mirrors every heartbeat line into a plain-text log
// beside it — the *ambient* surface a person keeps open with `tail -F` to watch the run stream on
// across a session cut, without typing for `--list` each time.
const AMBIENT_LINE = '⏳ at 2026-09-13 15:30+09:00 / 06:30Z · quiet 3m · lanes none · next later'
const AMBIENT_NEXT = '⏳ at 2026-09-13 15:50+09:00 / 06:50Z · quiet 20m · lanes none · next later'
const AMBIENT_WHEN = Date.parse('2026-09-20T06:30:00.000Z')
const MINUTE_MS = 60_000
// One blank line between blocks means at most two consecutive newlines; a third marks a wider gap.
const MAX_CONSECUTIVE_NEWLINES = 2
const TOO_WIDE_GAP = '\n'.repeat(MAX_CONSECUTIVE_NEWLINES + 1)

function ambient_blocks(target: string): ReadonlyArray<string> {
	const log = run_progress_clock.log_path_of(target)

	if (!existsSync(log)) return []

	return readFileSync(log, 'utf8')
		.split('\n\n')
		.map((block) => block.trimEnd())
		.filter((block) => block.length > 0)
}

describe('the report clock mirrors heartbeats into the ambient log', () => {
	it('names the ambient log as a sibling of the report clock', () => {
		expect(run_progress_clock.log_path_of('/scratch/clock.json')).toBe('/scratch/clock.json.log')
	})

	it('writes the heartbeat line into the ambient log', () => {
		const target = path.join(TEMPORARY, 'ambient-one.json')

		run_progress_clock.mark(target, AMBIENT_WHEN, AMBIENT_LINE)

		expect(ambient_blocks(target)).toStrictEqual([
			`${new Date(AMBIENT_WHEN).toISOString()}\n${AMBIENT_LINE}`,
		])
	})

	it('appends a second heartbeat that lands within the run', () => {
		const target = path.join(TEMPORARY, 'ambient-two.json')

		run_progress_clock.mark(target, AMBIENT_WHEN, AMBIENT_LINE)
		run_progress_clock.mark(target, AMBIENT_WHEN + MINUTE_MS, AMBIENT_NEXT)

		expect(ambient_blocks(target)).toHaveLength(2)
	})

	// The raw file, not the trimmed blocks: a re-read that kept the trailing newline would grow a blank
	// line between every pair of blocks, so the reader's `tail -F` surface must separate them by exactly
	// one blank line.
	it('separates blocks by a single blank line on disk', () => {
		const target = path.join(TEMPORARY, 'ambient-format.json')

		run_progress_clock.mark(target, AMBIENT_WHEN, AMBIENT_LINE)
		run_progress_clock.mark(target, AMBIENT_WHEN + MINUTE_MS, AMBIENT_NEXT)

		const raw = readFileSync(run_progress_clock.log_path_of(target), 'utf8')

		expect(raw).not.toContain(TOO_WIDE_GAP)
	})
})

describe('the ambient log resets on a stale run and is bounded', () => {
	// A gap longer than any interval belongs to a previous run, so the log opens fresh rather than on
	// stale lines.
	it('resets the log when the newest block predates this run', () => {
		const target = path.join(TEMPORARY, 'ambient-stale.json')
		const later = AMBIENT_WHEN + run_progress_clock.LOG_STALE_MS + MINUTE_MS

		run_progress_clock.mark(target, AMBIENT_WHEN, AMBIENT_LINE)
		run_progress_clock.mark(target, later, AMBIENT_NEXT)

		expect(ambient_blocks(target)).toStrictEqual([
			`${new Date(later).toISOString()}\n${AMBIENT_NEXT}`,
		])
	})

	it('keeps only the most recent LOG_KEEP heartbeats', () => {
		const target = path.join(TEMPORARY, 'ambient-cap.json')
		const count = run_progress_clock.LOG_KEEP + 3

		for (let index = 0; index < count; index += 1) {
			run_progress_clock.mark(
				target,
				AMBIENT_WHEN + index * MINUTE_MS,
				`${AMBIENT_LINE} ${String(index)}`,
			)
		}

		expect(ambient_blocks(target)).toHaveLength(run_progress_clock.LOG_KEEP)
	})

	// A bare `--mark` moves the clock on a real report without a heartbeat line, so it writes nothing to
	// the ambient log — the tier is for observed heartbeats, not for the run's own reports.
	it('writes nothing to the ambient log for a bare mark', () => {
		const target = path.join(TEMPORARY, 'ambient-bare.json')

		run_progress_clock.mark(target, AMBIENT_WHEN)

		expect(ambient_blocks(target)).toStrictEqual([])
	})
})
