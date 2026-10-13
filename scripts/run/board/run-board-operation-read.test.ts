import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_operation_read, type OperationSources } from './run-board-operation-read'

// joshuafolkken/kit#3757: the end of each session's log, read in a fixed amount — and no operation
// from a log that is missing or cannot be read.

const AT = '2026-10-13T09:00:00.000Z'
const AT_MS = Date.parse(AT)
const LANE_LOG = '/logs/josh-lane-dispatch-7.log'
const OWNER_LOG = '/home/.claude/projects/kit/session.jsonl'
const WAKE_LOG = '/logs/josh-run-wake-log.log'
const ROOT = '/work/kit'
const GATE = 'pnpm josh gate'
const PLAN = 'pnpm josh backlog:plan'
const JUDGE = 'pnpm josh issue:read 7'
const LONG_LINE_LENGTH = 200_000
const LONG_LINE = JSON.stringify({ type: 'user', text: 'x'.repeat(LONG_LINE_LENGTH) })
const NONE = { log: undefined, root: undefined }
const OWNER = { log: OWNER_LOG, root: ROOT }
const LANES = [{ issue: '7', log: LANE_LOG, root: '/lanes/7' }]
const directories: Array<string> = []

function call_line(command: string): string {
	const content = [{ type: 'tool_use', name: 'Bash', input: { command } }]

	return JSON.stringify({ type: 'assistant', timestamp: AT, message: { content } })
}

const LOGS: Readonly<Record<string, string>> = {
	[LANE_LOG]: call_line(GATE),
	[OWNER_LOG]: call_line(PLAN),
	[WAKE_LOG]: call_line(JUDGE),
}

function sources(extra: Partial<OperationSources> = {}): OperationSources {
	return { lanes: [], owner: NONE, judgment: NONE, ...extra }
}

// A real log holding `text`, and the read of it as the parent's.
function owner_of(text: string): ReturnType<typeof run_board_operation_read.read>['owner'] {
	const directory = mkdtempSync(path.join(tmpdir(), 'run-board-operation-'))
	const log = path.join(directory, 'session.log')

	directories.push(directory)
	writeFileSync(log, text)

	return run_board_operation_read.read(sources({ owner: { log, root: undefined } })).owner
}

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

describe('run_board_operation_read.read', () => {
	it('reads each session’s newest operation from its own log, a lane’s under its issue', () => {
		const read_tail = vi.fn((file_path: string) => LOGS[file_path] ?? '')
		const every = sources({ lanes: LANES, owner: OWNER, judgment: { log: WAKE_LOG, root: ROOT } })

		expect(run_board_operation_read.read(every, read_tail)).toStrictEqual({
			lanes: [{ issue: 7, operation: { kind: 'Bash', target: GATE, at_ms: AT_MS } }],
			owner: { kind: 'Bash', target: PLAN, at_ms: AT_MS },
			judgment: { kind: 'Bash', target: JUDGE, at_ms: AT_MS },
		})
	})

	it('asks for the same fixed amount of every log', () => {
		const read_tail = vi.fn(() => '')

		run_board_operation_read.read(sources({ lanes: LANES, owner: OWNER }), read_tail)

		expect(read_tail.mock.calls).toStrictEqual([
			[LANE_LOG, run_board_operation_read.TAIL_BYTES],
			[OWNER_LOG, run_board_operation_read.TAIL_BYTES],
		])
	})

	it('reads no operation where a session names no log, and opens nothing for it', () => {
		const read_tail = vi.fn(() => call_line(GATE))
		const lanes = [{ issue: '7', ...NONE }]

		expect(run_board_operation_read.read(sources({ lanes }), read_tail)).toStrictEqual({
			lanes: [],
			owner: undefined,
			judgment: undefined,
		})
		expect(read_tail).not.toHaveBeenCalled()
	})

	it('reads no operation from a log that cannot be read', () => {
		const missing = path.join(tmpdir(), 'run-board-operation-missing', 'none.log')
		const lanes = [{ issue: '7', log: missing, root: undefined }]

		expect(run_board_operation_read.read(sources({ lanes })).lanes).toStrictEqual([])
	})
})

describe('run_board_operation_read.read on a real log', () => {
	it('reads the newest call after a line longer than the read itself', () => {
		const owner = owner_of(`${call_line(PLAN)}\n${LONG_LINE}\n${call_line(GATE)}\n`)

		expect(owner?.target).toBe(GATE)
	})

	it('reads no operation where the newest call lies before the amount it reads', () => {
		expect(LONG_LINE_LENGTH).toBeGreaterThan(run_board_operation_read.TAIL_BYTES)
		expect(owner_of(`${call_line(PLAN)}\n${LONG_LINE}\n`)).toBeUndefined()
	})
})
