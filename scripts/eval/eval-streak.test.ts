import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eval_streak, type Streak } from './eval-streak'

// A real file in a throwaway directory rather than a mock: what this module is for is surviving
// between two processes, and a mocked filesystem would assert the calls rather than the survival.
// Held in an object so each hook writes a property rather than a top-level binding.
const sandbox = { directory: '' }

function target(): string {
	return path.join(sandbox.directory, 'streak.json')
}

beforeEach(() => {
	sandbox.directory = mkdtempSync(path.join(tmpdir(), 'josh-eval-streak-test-'))
})

afterEach(() => {
	rmSync(sandbox.directory, { force: true, recursive: true })
})

function streak(verdict: string, count: number): Streak {
	return { verdict, count }
}

describe('eval_streak.record', () => {
	it('starts at one when nothing was recorded before', () => {
		expect(eval_streak.record('unmeasured', target())).toStrictEqual({
			verdict: 'unmeasured',
			count: 1,
		})
	})

	// The run this exists to make visible: the same non-measurement, again, across processes.
	it('counts the same verdict up across runs', () => {
		eval_streak.record('unreachable', target())
		eval_streak.record('unreachable', target())

		expect(eval_streak.record('unreachable', target()).count).toBe(3)
	})

	// Counting two different verdicts together would announce a connection problem to somebody whose
	// scenario simply failed.
	it('starts again when the verdict changes', () => {
		eval_streak.record('unmeasured', target())

		expect(eval_streak.record('blocked', target()).count).toBe(1)
	})

	it('reads back what it recorded', () => {
		eval_streak.record('unmeasured', target())

		expect(eval_streak.read_streak(target())).toStrictEqual({ verdict: 'unmeasured', count: 1 })
	})

	// A record is an aid to noticing, never a gate: an unreadable one starts again rather than ending
	// a run whose sessions are already paid for.
	it('starts again from an unreadable record', () => {
		writeFileSync(target(), 'not json at all')

		expect(eval_streak.record('unmeasured', target()).count).toBe(1)
	})

	it('starts again from a record of the wrong shape', () => {
		writeFileSync(target(), JSON.stringify({ verdict: 'unmeasured', count: 'many' }))

		expect(eval_streak.record('unmeasured', target()).count).toBe(1)
	})

	it('reads an absent record as nothing recorded', () => {
		expect(eval_streak.read_streak(target())).toBeUndefined()
	})
})

describe('eval_streak.streak_warning', () => {
	// A healthy run says nothing however many of them there have been.
	it.each([1, eval_streak.STREAK_ALARM, eval_streak.STREAK_ALARM + 5])(
		'says nothing about %d runs that held',
		(count) => {
			expect(eval_streak.streak_warning(streak('held', count))).toBeUndefined()
		},
	)

	// One is already reported by the verdict line, and repeating it there would be noise rather than
	// a signal.
	it('says nothing about a single non-measurement', () => {
		expect(eval_streak.streak_warning(streak('unmeasured', 1))).toBeUndefined()
	})

	// `blocked` is the opposite state: the rules were measured, one failed, and it already stops the
	// merge. Warning here would tell somebody iterating on a genuinely red scenario that their
	// measurement never happened.
	it.each([eval_streak.STREAK_ALARM, eval_streak.STREAK_ALARM + 2])(
		'says nothing about %d blocked runs, which measured something',
		(count) => {
			expect(eval_streak.streak_warning(streak('blocked', count))).toBeUndefined()
		},
	)

	it('warns once the run reaches the alarm', () => {
		const warning = eval_streak.streak_warning(streak('unmeasured', eval_streak.STREAK_ALARM))

		expect(warning).toContain(String(eval_streak.STREAK_ALARM))
		expect(warning).toContain('unmeasured')
	})

	it('keeps warning past the alarm', () => {
		expect(
			eval_streak.streak_warning(streak('unreachable', eval_streak.STREAK_ALARM + 1)),
		).toContain('unreachable')
	})
})

describe('eval_streak.report_streak', () => {
	it('prints the warning once the run reaches the alarm', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		for (let run = 0; run < eval_streak.STREAK_ALARM; run += 1) {
			eval_streak.report_streak('unreachable', target())
		}

		expect(error.mock.calls.at(-1)?.at(0)).toContain('runs in a row')

		error.mockRestore()
	})

	it('prints nothing while the runs are still holding', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(eval_streak.report_streak('held', target())).toBeUndefined()
		expect(error).not.toHaveBeenCalled()

		error.mockRestore()
	})
})
