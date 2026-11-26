import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_prefix_stats, type SessionPrefix } from './lane-prefix-stats'
import { lane_stats } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// joshuafolkken/kit#8704: `lane:stats` reports a lane child's first-request context per model and the
// share of lane sessions that called ToolSearch, so a jump in the fixed prefix shows in one table.

const make_directory = temporary_directory('suite')
const NOW = Date.parse('2026-11-23T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const MS_PER_HOUR = 3_600_000
const TWO_DAYS_MS = 172_800_000
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const FIRST_AT = '2026-11-23T10:00:00.000Z'
const LATER_AT = '2026-11-23T10:01:00.000Z'

interface LineOptions {
	request: string
	at: string
	model?: string
	input?: number
}

function assistant_line({ request, at, model = OPUS, input = 0 }: LineOptions): string {
	const usage = {
		input_tokens: 2,
		cache_creation_input_tokens: input,
		cache_read_input_tokens: 100,
		output_tokens: 5,
	}

	return JSON.stringify({
		type: 'assistant',
		requestId: request,
		timestamp: at,
		message: { model, usage },
	})
}

function prefix(session_id: string, model: string, tokens: number): SessionPrefix {
	return { session_id, model, at_ms: NOW - MS_PER_HOUR, tokens }
}

function search_call(session_id: string): ToolCall {
	return {
		session_id,
		lane: 'lane-1',
		started_ms: NOW - MS_PER_HOUR,
		duration_ms: 1,
		tool: 'ToolSearch',
		background: false,
		command: undefined,
		subagent: undefined,
		output: '',
	}
}

function row_cells(table: string, label: string): Array<string> | undefined {
	const line = table.split('\n').find((text) => text.startsWith(`| ${label} |`))

	return line
		?.split('|')
		.slice(1, -1)
		.map((cell) => cell.trim())
}

describe('lane_prefix_stats.first_request', () => {
	it('sums the first request input with its cache reads and writes', () => {
		const raw = [
			JSON.stringify({ type: 'user', timestamp: FIRST_AT, message: { content: 'go' } }),
			assistant_line({ request: 'r1', at: FIRST_AT, input: 20_000 }),
			assistant_line({ request: 'r1', at: FIRST_AT, input: 20_000 }),
			assistant_line({ request: 'r2', at: LATER_AT, input: 90_000 }),
		].join('\n')

		expect(lane_prefix_stats.first_request('s1', raw)).toStrictEqual({
			session_id: 's1',
			model: OPUS,
			at_ms: Date.parse(FIRST_AT),
			tokens: 20_102,
		})
	})

	it('leaves out a session cut before its first answer', () => {
		const raw = JSON.stringify({ type: 'user', timestamp: FIRST_AT, message: { content: 'go' } })

		expect(lane_prefix_stats.first_request('s1', raw)).toBeUndefined()
	})

	it('skips a synthetic message for the first priced request', () => {
		const raw = [
			assistant_line({ request: 'r0', at: FIRST_AT, model: '<synthetic>' }),
			assistant_line({ request: 'r1', at: LATER_AT, input: 300 }),
		].join('\n')

		expect(lane_prefix_stats.first_request('s1', raw)?.tokens).toBe(402)
	})
})

describe('lane_prefix_stats.first_request — a first request with no timestamp', () => {
	it('is placed at the session first timestamp', () => {
		const untimed = JSON.parse(assistant_line({ request: 'r1', at: FIRST_AT, input: 500 }))
		const raw = [
			JSON.stringify({ ...untimed, timestamp: undefined }),
			assistant_line({ request: 'r2', at: LATER_AT, input: 90_000 }),
		].join('\n')

		expect(lane_prefix_stats.first_request('s1', raw)).toMatchObject({
			at_ms: Date.parse(LATER_AT),
			tokens: 602,
		})
	})
})

describe('lane_prefix_stats.prefixes_of', () => {
	it('reads every lane session written to in the window and drops the ones with no request', () => {
		const directory = make_directory('lane-prefix-stats-test-')

		writeFileSync(
			path.join(directory, 'a.jsonl'),
			assistant_line({ request: 'r1', at: FIRST_AT, input: 900 }),
		)
		writeFileSync(path.join(directory, 'b.jsonl'), '')

		const sessions = lane_transcript_stats.read_sessions([directory], {
			since_ms: 0,
			until_ms: NOW,
		})
		const prefixes = lane_prefix_stats.prefixes_of(sessions)

		expect(prefixes.map((one) => [one.session_id, one.tokens])).toStrictEqual([['a', 1002]])
	})
})

describe('lane_prefix_stats.table', () => {
	const prefixes = [
		prefix('o1', OPUS, 20_000),
		prefix('o2', OPUS, 22_000),
		prefix('o3', OPUS, 21_000),
		prefix('s1', SONNET, 15_000),
		{ ...prefix('old', OPUS, 99_000), at_ms: NOW - TWO_DAYS_MS },
	]
	const table = lane_prefix_stats.table(prefixes, [search_call('o1'), search_call('o1')], WINDOW)

	it('prints the median first-request context per model and the ToolSearch share', () => {
		expect(row_cells(table, OPUS)).toStrictEqual([OPUS, '3', '21000', '1', '33.3'])
		expect(row_cells(table, SONNET)).toStrictEqual([SONNET, '1', '15000', '0', '0.0'])
	})

	it('closes with every model together, the period only', () => {
		expect(row_cells(table, 'all')).toStrictEqual(['all', '4', '20500', '1', '25.0'])
	})

	it('prints the all row unmeasured when no session fell in the period', () => {
		expect(row_cells(lane_prefix_stats.table([], [], WINDOW), 'all')).toStrictEqual([
			'all',
			'0',
			lane_stats.MISSING,
			'0',
			lane_stats.MISSING,
		])
	})
})
