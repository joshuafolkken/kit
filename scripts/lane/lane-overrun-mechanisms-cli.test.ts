import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_event_overrun, type SmallCause } from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_overrun_mechanisms_cli } from './lane-overrun-mechanisms-cli'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#4886: the causes each lane left under 3% are summed per mechanism across lanes, so a
// mechanism that loses a few minutes in every lane is filed.

const NOW_MS = Date.parse('2026-10-25T12:00:00.000Z')
const DAY_START = Date.parse('2026-10-25T00:00:00.000Z')
const MS_PER_MINUTE = 60_000
const PERIOD_DAYS = 1
const OLD_AT = '2026-10-01T00:00:00.000Z'
const NONE_RESULT = run_event_overrun.none_result('all causes <3%')
const PINNED = 'test:pinned'
const LABEL = 'the last 1 day(s)'
const HEAD = `overrun mechanisms in ${LABEL}: 3 merge(s), median lane 51.0 min`

// The three 2026-10-25 lanes the issue names: their lane minutes and the test:pinned losses their
// investigations found (6 + 6.4, 3.6 and 9 minutes).
interface Lane {
	issue: number
	minutes: number
	causes: ReadonlyArray<SmallCause>
}

const LANES: ReadonlyArray<Lane> = [
	{
		issue: 4873,
		minutes: 65,
		causes: [
			{ key: PINNED, minutes: 6, cause: 'pinned rerun after the review' },
			{ key: PINNED, minutes: 6.4, cause: 'run:review restarted test:pinned' },
		],
	},
	{
		issue: 4880,
		minutes: 49,
		causes: [{ key: PINNED, minutes: 3.6, cause: 'unpinned fixture' }],
	},
	{
		issue: 4878,
		minutes: 51,
		causes: [
			{ key: PINNED, minutes: 9, cause: 'round 2 reread the pinned run' },
			{ key: 'token-cut', minutes: 2, cause: 'cut before the gate' },
		],
	},
]

function at(minutes: number): string {
	return new Date(DAY_START + minutes * MS_PER_MINUTE).toISOString()
}

// Each lane is dispatched, merged its minutes later, and its result note written at the merge.
function ledger(): Array<LedgerEntry> {
	return LANES.flatMap(({ issue, minutes }, index) => [
		{ kind: 'dispatch', at: at(index * 100), issue },
		{ kind: 'merge', at: at(index * 100 + minutes), issue },
	])
}

function note(text: string, note_at: string, pos = 0): RunEvent {
	return { pos, at: note_at, kind: run_event_stream.EVENT_KIND.NOTE, text }
}

function events(): Array<RunEvent> {
	return LANES.map(({ issue, minutes, causes }, index) => {
		const result = `${NONE_RESULT}${run_event_overrun.small_causes_text(causes)}`

		return note(run_event_overrun.ended_text(issue, result), at(index * 100 + minutes), index)
	})
}

function report(lane_events: ReadonlyArray<RunEvent>): Array<string> {
	const window = lane_stats.window_of(PERIOD_DAYS, NOW_MS)

	return lane_overrun_mechanisms_cli
		.report({ entries: ledger(), events: lane_events }, window, LABEL)
		.split('\n')
}

describe('lane_overrun_mechanisms_cli.report — the 2026-10-25 lanes', () => {
	it('sums test:pinned past 3% of the median lane and sends it to filing', () => {
		expect(report(events())).toStrictEqual([
			HEAD,
			'test:pinned  25.0 min over 4 cause(s) · 8.3 min/merge · 16.3% — file (urgent)',
			'token-cut  2.0 min over 1 cause(s) · 0.7 min/merge · 1.3% — under 3%',
		])
	})

	it('leaves out a note outside the period and a free-text cause written before the keys', () => {
		const old = note(
			run_event_overrun.ended_text(4700, `${NONE_RESULT} — under 3%: x 90 min: y`),
			OLD_AT,
		)
		const free = note(
			run_event_overrun.ended_text(4701, `${NONE_RESULT} — under 3%: slow CI`),
			at(1),
		)

		expect(report([old, free])).toStrictEqual([HEAD, 'no keyed small overrun causes recorded'])
	})
})

describe('lane_overrun_mechanisms_cli.report — a period with no merge', () => {
	it('sums the causes but gives no share or verdict', () => {
		const window = lane_stats.window_of(PERIOD_DAYS, NOW_MS)
		const text = lane_overrun_mechanisms_cli.report(
			{ entries: [], events: events() },
			window,
			LABEL,
		)

		expect(text.split('\n')).toContain('test:pinned  25.0 min over 4 cause(s) · — · — — —')
	})
})

describe('lane_overrun_mechanisms_cli.losses_of', () => {
	it('reads only overrun result notes', () => {
		const start = run_event_overrun.started_text(
			4873,
			65,
			run_event_overrun.investigating(1, undefined),
		)

		const parks = events().map((event) => ({ ...event, kind: run_event_stream.EVENT_KIND.PARK }))
		const notes = [note(start, at(0)), ...events()]

		expect(lane_overrun_mechanisms_cli.losses_of(notes)).toHaveLength(2)
		expect(lane_overrun_mechanisms_cli.losses_of(parks)).toStrictEqual([])
	})
})

function scratch(): { ledger_path: string; events_path: string } {
	const directory = mkdtempSync(path.join(tmpdir(), 'overrun-mechanisms-'))

	onTestFinished(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	return {
		ledger_path: path.join(directory, 'ledger.jsonl'),
		events_path: path.join(directory, 'events.jsonl'),
	}
}

function jsonl(rows: ReadonlyArray<object>): string {
	return rows.map((row) => `${JSON.stringify(row)}\n`).join('')
}

async function captured(argv: ReadonlyArray<string>): Promise<{ code: number; text: string }> {
	const paths = scratch()

	writeFileSync(paths.ledger_path, jsonl(ledger()))
	writeFileSync(paths.events_path, jsonl(events()))

	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
	const code = await lane_overrun_mechanisms_cli.run(argv, { ...paths, now_ms: NOW_MS })
	const text = [...info.mock.calls, ...error.mock.calls].map((call) => String(call[0])).join('\n')

	info.mockRestore()
	error.mockRestore()

	return { code, text }
}

describe('lane_overrun_mechanisms_cli.run', () => {
	it('reads the ledger and the event stream it is pointed at', async () => {
		const { code, text } = await captured(['--period', '1'])

		expect(code).toBe(0)
		expect(text).toContain('test:pinned  25.0 min over 4 cause(s)')
	})

	it('drops the causes before --since, the close of the issue that fixed a mechanism', async () => {
		const { code, text } = await captured(['--period', '1', '--since', at(150)])

		expect(code).toBe(0)
		expect(text.split('\n')).toStrictEqual([
			`overrun mechanisms in the last 1 day(s) since ${at(150)}: 1 merge(s), median lane 51.0 min`,
			'test:pinned  9.0 min over 1 cause(s) · 9.0 min/merge · 17.6% — file (urgent)',
			'token-cut  2.0 min over 1 cause(s) · 2.0 min/merge · 3.9% — file',
		])
	})

	it.each([
		['--period', '0'],
		['--period', 'week'],
		['--since', 'yesterday'],
		['--until', '1'],
	])('refuses %s %s with the usage line', async (...argv) => {
		const { code, text } = await captured(argv)

		expect(code).toBe(1)
		expect(text).toBe('usage: josh overrun:mechanisms [--period <days>] [--since <instant>]')
	})
})
