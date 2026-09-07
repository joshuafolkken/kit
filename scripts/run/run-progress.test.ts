import { describe, expect, it } from 'vitest'
import { run_progress, type Observations } from './run-progress'

// joshuafolkken/kit#1520. The two properties that make this a progress report rather than a timer:
// it fires on silence measured from the last report, and the line carries observations that move.

const MINUTE = run_progress.MS_PER_MINUTE
const NOW = 10 * 60 * MINUTE
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

describe('interval_from — configurable, disable-able, and never fatal', () => {
	it('defaults to ten minutes, the value live use settled on', () => {
		expect(run_progress.interval_from(undefined)).toBe(10 * MINUTE)
		expect(run_progress.DEFAULT_INTERVAL_MINUTES).toBe(10)
	})

	it('takes a positive number of minutes from the environment', () => {
		expect(run_progress.interval_from('20')).toBe(20 * MINUTE)
	})

	it('falls back rather than throwing, so a typo cannot end an unattended run', () => {
		for (const raw of ['', '  ', 'ten', '0', '-5', 'NaN']) {
			expect(run_progress.interval_from(raw)).toBe(run_progress.DEFAULT_INTERVAL_MS)
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
