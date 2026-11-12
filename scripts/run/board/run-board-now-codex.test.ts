import { describe, expect, it } from 'vitest'
import { run_board_now } from './run-board-now'
import { run_board_now_fixture } from './run-board-now-fixture'
import { run_board_operation_codex_fixture } from './run-board-operation-codex-fixture'
import { run_board_operation_read } from './run-board-operation-read'
import type { RunActivity } from './run-board-status'

const { AT, ROOT, command, file } = run_board_operation_codex_fixture
const SECOND = 1000
const AT_MS = Date.parse(AT)
const LATER = new Date(AT_MS + 5 * SECOND).toISOString()
const NONE = { log: undefined, root: undefined }
const ACTIVITY: RunActivity = { last_event_ms: AT_MS, is_stopped: false }

function drawn(logs: ReadonlyArray<string>, now_ms: number, activity = ACTIVITY): string {
	const operations = run_board_operation_read.read(
		{
			lanes: logs.map((_log, issue) => ({ issue: String(issue), log: String(issue), root: ROOT })),
			owner: NONE,
			judgment: NONE,
		},
		(log) => logs[Number(log)] ?? '',
	)

	return run_board_now_fixture.drawn(
		run_board_now.line_of({
			now_ms,
			ended_ms: undefined,
			activity,
			operations,
			children: new Set([0, 1]),
			running: 2,
			waiting: 0,
			people: 0,
		}),
	)
}

describe('Codex logs through the board third line', () => {
	it('ages the recorded command time and resets on the next file change', () => {
		const log = command('pnpm josh gate')
		const updated = [log, file(`${ROOT}/a.ts`, LATER)].join('\n')

		expect(drawn([log], AT_MS + SECOND)).toBe('1″ 🔧 #0 · Bash pnpm josh gate')
		expect(drawn([log], AT_MS + 5 * SECOND)).toBe('5″ 🔧 #0 · Bash pnpm josh gate')
		expect(drawn([updated], AT_MS + 6 * SECOND)).toBe('1″ 🔧 #0 · Edit a.ts')
	})

	it('compares Claude and Codex times and excludes a stopped lane', () => {
		const claude = JSON.stringify({
			timestamp: LATER,
			message: {
				content: [{ type: 'tool_use', name: 'Read', input: { file_path: `${ROOT}/b.ts` } }],
			},
		})

		expect(drawn([command('ls'), claude, file('/stopped.ts', LATER)], AT_MS + 6 * SECOND)).toBe(
			'1″ 🔧 #1 · Read b.ts',
		)
	})

	it('compares a Codex operation against a newer lane event', () => {
		const activity = {
			...ACTIVITY,
			lane_events: new Map([
				[0, { phase: 'gate' as const, words: 'ship gate', at_ms: Date.parse(LATER) }],
			]),
		}

		expect(drawn([command('ls')], AT_MS + 6 * SECOND, activity)).toBe('1″ 🚦 #0 · ship gate')
	})
})
