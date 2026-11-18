import type { TimelineEvent } from '#scripts/epic/epic-label-age'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { ConfirmationEntry } from '#scripts/notify/confirmation-ledger'
import { describe, expect, it } from 'vitest'
import { lane_human_wait_stats, type HumanWait } from './lane-human-wait-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#7890: each stop left to a person reduces to its waits' count, median, maximum,
// total and unanswered count — a label from its timeline, a label-less stop from the confirmation
// ledger.

const NOW = Date.parse('2026-11-18T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const DECISION = 'needs-decision'
const MERGE = 'needs-human-merge'
const RUN_STOPPED = 'run-stopped'
// The median, maximum and total of a row with no answered wait.
const NO_WAITS = 'not measured | not measured | not measured'

function minutes_ago(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

const OUTSIDE = minutes_ago(2 * 24 * 60)

function labeled(minutes: number, name = DECISION): TimelineEvent {
	return { event: 'labeled', created_at: minutes_ago(minutes), label: { name } }
}

function unlabeled(minutes: number, name = DECISION): TimelineEvent {
	return { event: 'unlabeled', created_at: minutes_ago(minutes), label: { name } }
}

function closed(minutes: number): TimelineEvent {
	return { event: 'closed', created_at: minutes_ago(minutes) }
}

function row_of(waits: ReadonlyArray<HumanWait>, reason: string): string {
	const rows = lane_human_wait_stats.table(waits, WINDOW).split('\n')

	return rows.find((row) => row.startsWith(`| ${reason} |`)) ?? ''
}

function asked(reason: string, at: string, answered_at?: string): ConfirmationEntry {
	return { reason, checkout: '/repo', asked_at: at, ...(answered_at && { answered_at }) }
}

describe('lane_human_wait_stats.label_waits', () => {
	it('ends a wait at the same label taken off or the issue closed, whichever comes first', () => {
		const waits = lane_human_wait_stats.label_waits([
			labeled(60),
			unlabeled(50, MERGE),
			closed(30),
			unlabeled(20),
		])

		expect(waits).toStrictEqual([
			{ reason: DECISION, at: minutes_ago(60), answered_at: minutes_ago(30) },
		])
	})

	it('counts a label put back on the same issue as a wait of its own', () => {
		const waits = lane_human_wait_stats.label_waits([
			labeled(60),
			unlabeled(50),
			labeled(40),
			unlabeled(10),
		])

		expect(row_of(waits, DECISION)).toBe(`| ${DECISION} | 2 | 20.0 | 30.0 | 40.0 | 0 |`)
	})

	it('keeps a label never taken off as an open wait and skips labels that are no stop', () => {
		const waits = lane_human_wait_stats.label_waits([labeled(60), labeled(30, 'in-progress')])

		expect(waits).toStrictEqual([{ reason: DECISION, at: minutes_ago(60) }])
	})
})

describe('lane_human_wait_stats.confirmation_waits', () => {
	it('reads only the label-less stops, each from asked_at to answered_at', () => {
		const waits = lane_human_wait_stats.confirmation_waits([
			asked(RUN_STOPPED, minutes_ago(30), minutes_ago(20)),
			asked(DECISION, minutes_ago(30), minutes_ago(20)),
		])

		expect(row_of(waits, RUN_STOPPED)).toBe(`| ${RUN_STOPPED} | 1 | 10.0 | 10.0 | 10.0 | 0 |`)
		expect(row_of(waits, DECISION)).toBe(`| ${DECISION} | 0 | ${NO_WAITS} | 0 |`)
	})
})

describe('lane_human_wait_stats.table', () => {
	it('counts an unanswered wait only under unanswered', () => {
		const waits = [
			{ reason: MERGE, at: minutes_ago(90), answered_at: minutes_ago(30) },
			{ reason: MERGE, at: minutes_ago(10) },
		]

		expect(row_of(waits, MERGE)).toBe(`| ${MERGE} | 2 | 60.0 | 60.0 | 60.0 | 1 |`)
	})

	it('leaves out a wait that began before the period, even if it ended inside', () => {
		const waits = [{ reason: MERGE, at: OUTSIDE, answered_at: minutes_ago(10) }]

		expect(row_of(waits, MERGE)).toBe(`| ${MERGE} | 0 | ${NO_WAITS} | 0 |`)
	})

	it('prints one row per stop key in issue-human-stops order', () => {
		const rows = lane_human_wait_stats.table([], WINDOW).split('\n').slice(2)

		expect(rows.map((row) => row.split('|', 2)[1]?.trim())).toContain(RUN_STOPPED)
		expect(rows[0]).toBe(`| ${DECISION} | 0 | ${NO_WAITS} | 0 |`)
	})
})
