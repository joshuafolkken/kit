import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'
import type { Breakdown } from '#scripts/lane/lane-breakdown'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { describe, expect, it } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_rewrite } from './cost-audit-rewrite'
import { cost_audit_wait, type WaitTable } from './cost-audit-wait'

const { ms, record, request_line, session } = cost_audit_fixture
const ISSUE = 8308
const WRITTEN = 100_000
const USD_DECIMALS = 6

function always(): boolean {
	return true
}

// A request that writes `WRITTEN` cache tokens and reads none back — a rewrite after any earlier one.
function write(id: string, minute: number): UsageRecord {
	const base = record(id, minute, 0)

	return { ...base, totals: { ...base.totals, cache_write_5m_tokens: WRITTEN } }
}

function bash(command: string): { name: string; input: unknown } {
	return { name: 'Bash', input: { command } }
}

function with_lines(base: AuditSession, lines: ReadonlyArray<string>): AuditSession {
	return { ...base, lines: time_transcript_line.parse_text(lines.join('\n')) }
}

const BREAKDOWN: Breakdown = {
	stages: [],
	excluded_ms: 0,
	slept_ms: 0,
	yield_ms: 0,
	waits: [],
	plan: [{ from_ms: ms(0), to_ms: ms(10) }],
	implement: [],
	pre_detach: [],
	ship: [],
}

// A lane child rewrites after a josh call's wait past the TTL, and again inside it.
const LANE = with_lines(
	{ ...session('fullrun', [write('a', 0), write('b', 6), write('c', 7)], [], true), issue: ISSUE },
	[
		request_line(0, 'a', 0, [bash('pnpm josh run:chain 8308 --join')]),
		request_line(6, 'b', 0, [bash('ls')]),
	],
)
const HANDOFF = with_lines(session('handoff', [write('d', 0), write('e', 20)]), [
	request_line(0, 'd', 0, [bash('git status')]),
])
const CONVERSATION = with_lines(session('conversation', [write('f', 0), write('g', 30)]), [
	request_line(0, 'f', 0, [{ name: 'Read', input: { file_path: 'a.ts' } }]),
])
const SUBAGENT = session('subagent', [write('h', 0), write('i', 9)])
const SESSIONS = [LANE, HANDOFF, CONVERSATION, SUBAGENT]

function waits(): Array<WaitTable> {
	return cost_audit_wait.waits_of({
		sessions: SESSIONS,
		breakdowns: new Map([[ISSUE, BREAKDOWN]]),
		is_counted: always,
	})
}

function counts(table: WaitTable | undefined): Record<string, number> {
	return Object.fromEntries((table?.rows ?? []).map((row) => [row.key, row.count]))
}

function sum_of(table: WaitTable): { count: number; usd: string } {
	const count = table.rows.reduce((sum, row) => sum + row.count, 0)
	const usd = table.rows.reduce((sum, row) => sum + row.usd, 0)

	return { count, usd: usd.toFixed(USD_DECIMALS) }
}

// joshuafolkken/kit#8308: where the full cache rewrites after a wait past the cache TTL happen.
describe('cost_audit_wait.waits_of — the keys', () => {
	it('counts the after-wait rewrites by session kind, inside-TTL rewrites left out', () => {
		expect(counts(waits()[0])).toStrictEqual({
			fullrun: 1,
			handoff: 1,
			conversation: 1,
			subagent: 1,
		})
	})

	it('keys a lane child by its phase and any other session by its kind', () => {
		expect(counts(waits()[1])).toStrictEqual({
			'lane: plan': 1,
			handoff: 1,
			conversation: 1,
			subagent: 1,
		})
	})

	it('keys each by the call before it: josh subcommand, command key, tool name or none', () => {
		expect(counts(waits()[2])).toStrictEqual({
			'josh run:chain': 1,
			'git status': 1,
			Read: 1,
			[cost_audit_wait.NO_CALL]: 1,
		})
	})
})

describe('cost_audit_wait.waits_of — the totals', () => {
	it('adds every table up to the after-wait rewrite count and dollars', () => {
		const { after_wait } = cost_audit_rewrite.rewrites_in(SESSIONS, always)
		const expected = { count: after_wait.count, usd: after_wait.usd.toFixed(USD_DECIMALS) }

		expect(after_wait.count).toBe(SESSIONS.length)
		expect(waits().map((table) => sum_of(table))).toStrictEqual([expected, expected, expected])
	})

	it('counts no rewrite outside the counted window', () => {
		const tables = cost_audit_wait.waits_of({
			sessions: SESSIONS,
			breakdowns: new Map(),
			is_counted: () => false,
		})

		expect(tables.map((table) => table.rows)).toStrictEqual([[], [], []])
	})
})
