import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { session_cite } from '#scripts/issue/session-cite'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { review_stop_log, type StopLine } from './review-stop-log'
import { review_stops_cli } from './review-stops-cli'

// joshuafolkken/kit#4519: a period's review stop findings, listed by kind, file and sentence.

const NOW_MS = Date.parse('2026-10-22T12:00:00.000Z')
const OLD_AT = '2026-10-01T00:00:00.000Z'
const RECENT_AT = '2026-10-21T00:00:00.000Z'
const MEDIUM = 'bug-risks:medium'
const NO_FINDINGS = 'no review stop findings'
const WHERE = `${session_cite.issue(7)} review 2026-10-21`

function stop(kind: string, location: string, at: string = RECENT_AT): StopLine {
	return { at, issue: 7, stage: 'review', kind, location, sentence: `${location} is wrong.` }
}

function fresh_log(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'review-stops-cli-'))

	onTestFinished(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	return path.join(directory, 'review-stops.jsonl')
}

function captured(argv: ReadonlyArray<string>, log_path?: string): { code: number; text: string } {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
	const code = review_stops_cli.run(argv, { log_path, now_ms: NOW_MS })
	const text = [...info.mock.calls, ...error.mock.calls].map((call) => String(call[0])).join('\n')

	info.mockRestore()
	error.mockRestore()

	return { code, text }
}

describe('review_stops_cli.format_report', () => {
	it('orders the findings by kind, then file, one line each', () => {
		const report = review_stops_cli.format_report(
			[stop('tests:high', 'a.ts'), stop(MEDIUM, 'b.ts:9'), stop(MEDIUM, 'a.ts:3')],
			7,
		)

		expect(report.split('\n')).toStrictEqual([
			'review stop findings in the last 7 day(s) (3):',
			`${MEDIUM}  a.ts:3  ${WHERE} — a.ts:3 is wrong.`,
			`${MEDIUM}  b.ts:9  ${WHERE} — b.ts:9 is wrong.`,
			`tests:high  a.ts  ${WHERE} — a.ts is wrong.`,
		])
	})

	it('marks a finding that carried no sentence', () => {
		const report = review_stops_cli.format_report([{ ...stop(MEDIUM, 'a.ts'), sentence: '' }], 1)

		expect(report).toContain('— (no sentence)')
	})

	it('says so when the period has none', () => {
		expect(review_stops_cli.format_report([], 7)).toBe(
			'no review stop findings recorded in the last 7 day(s)',
		)
	})
})

describe('review_stops_cli.run', () => {
	it('lists the findings recorded inside the period, 7 days by default', () => {
		const log = fresh_log()

		review_stop_log.record({ issue: 7, stage: 'review', findings: [stop(MEDIUM, 'a.ts')] }, log)

		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const code = review_stops_cli.run([], { log_path: log })
		const text = String(info.mock.calls[0]?.[0])

		info.mockRestore()

		expect(code).toBe(0)
		expect(text).toContain(`${MEDIUM}  a.ts  ${session_cite.issue(7)} review`)
	})

	it('leaves out a finding a passing round fixed in place, which stopped nothing', () => {
		const log = fresh_log()

		review_stop_log.record(
			{ issue: 7, stage: 'review', findings: [stop(MEDIUM, 'fixed.ts')], is_fixed: true },
			log,
		)

		expect(captured([], log).text).toContain(NO_FINDINGS)
	})

	it('drops a finding older than the period', () => {
		const log = fresh_log()

		appendFileSync(log, `${JSON.stringify(stop(MEDIUM, 'old.ts', OLD_AT))}\n`)

		expect(captured(['--period', '7'], log).text).toContain(NO_FINDINGS)
		expect(captured(['--period', '30'], log).text).toContain(`${MEDIUM}  old.ts`)
	})

	it.each([['--period', '0'], ['--period', 'x'], ['--since']])(
		'refuses %j with the usage',
		(...argv) => {
			const { code, text } = captured(argv)

			expect(code).toBe(1)
			expect(text).toContain('usage: josh review:stops')
		},
	)
})
