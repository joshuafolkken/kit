import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { describe, expect, it } from 'vitest'
import { run_board_now, type NowRead } from './run-board-now'
import type { Operation } from './run-board-operation'
import type { SessionOperations } from './run-board-operation-read'
import type { RunActivity } from './run-board-status'

// joshuafolkken/kit#3757: the third line writes the newest operation of the session at work — a
// running child's, or the session a stage is the work of — and what it wrote before where there is
// none to write.

const SECOND = 1000
const MINUTE = 60 * SECOND
const NOW = Date.parse('2026-10-13T09:00:00.000Z')
const { STAGE } = run_event_setup
const JAPANESE = /[぀-ヿ一-鿿]/u
const GATE = 'pnpm josh gate'
const PLAN = 'pnpm josh backlog:plan'
const JUDGE = 'pnpm josh issue:read 5'
const NONE: SessionOperations = { lanes: [], owner: undefined, judgment: undefined }
const MERGED: RunActivity = {
	last_event_ms: NOW - MINUTE,
	is_stopped: false,
	latest: { text: '#5 merged', at_ms: NOW - MINUTE },
	idle_ms: NOW - MINUTE,
}

function bash(command: string, age_ms: number): Operation {
	return { kind: 'Bash', target: command, at_ms: NOW - age_ms }
}

function standing(setup: string, age_ms: number): RunActivity {
	return { ...MERGED, setup, setup_ms: NOW - age_ms }
}

function line_of(extra: Partial<NowRead>): string {
	return run_board_now.line_of({
		now_ms: NOW,
		ended_ms: undefined,
		activity: MERGED,
		running: 0,
		waiting: 0,
		people: 0,
		...extra,
	})
}

// Children `issues` running, each lane's newest operation as given.
function running(
	issues: ReadonlyArray<number>,
	lanes: SessionOperations['lanes'],
): Partial<NowRead> {
	return { running: issues.length, children: new Set(issues), operations: { ...NONE, lanes } }
}

describe('run_board_now.line_of while a child runs', () => {
	it('writes the child’s issue, its newest operation and how long ago, not how many run', () => {
		const lanes = [{ issue: 7, operation: bash('pnpm josh test:related', 4 * SECOND) }]
		const line = line_of(running([7], lanes))

		expect(line).toBe('#7 · Bash pnpm josh test:related  0:04')
		expect(line).not.toContain('running')
	})

	it('writes the newer operation of two lanes, under its own issue', () => {
		const lanes = [
			{ issue: 7, operation: bash(GATE, 9 * SECOND) },
			{
				issue: 8,
				operation: { kind: 'Edit', target: 'scripts/lane/lane-open.ts', at_ms: NOW - 2 * SECOND },
			},
		]

		expect(line_of(running([7, 8], lanes))).toBe('#8 · Edit scripts/lane/lane-open.ts  0:02')
	})

	it('writes a tool pointed at nothing by its name alone', () => {
		const lanes = [
			{ issue: 7, operation: { kind: 'Agent', target: undefined, at_ms: NOW - SECOND } },
		]

		expect(line_of(running([7], lanes))).toBe('#7 · Agent  0:01')
	})

	it('leaves out a lane whose child is not running, however new its operation', () => {
		const lanes = [
			{ issue: 7, operation: bash(GATE, MINUTE) },
			{ issue: 9, operation: bash('pnpm josh ship', SECOND) },
		]

		expect(line_of(running([7], lanes))).toBe('#7 · Bash pnpm josh gate  1:00')
	})
})

describe('run_board_now.line_of while a child runs — where no operation is to be read', () => {
	it('counts the children where no running child’s log gave an operation', () => {
		expect(line_of(running([7], []))).toBe('1 running')
		expect(line_of({ running: 2 })).toBe('2 running')
	})

	it('reads an operation dated ahead of the clock as done now', () => {
		const lanes = [{ issue: 7, operation: bash('ls', -3 * SECOND) }]

		expect(line_of(running([7], lanes))).toBe('#7 · Bash ls  0:00')
	})
})

describe('run_board_now.line_of at a stage a session works on', () => {
	it('writes the parent’s newest operation after `planning`', () => {
		const operations = { ...NONE, owner: bash(PLAN, 3 * SECOND) }
		const activity = standing(STAGE.PLANNING, MINUTE)

		expect(line_of({ activity, operations, waiting: 2 })).toBe(
			'planning · Bash pnpm josh backlog:plan  0:03',
		)
	})

	it('writes the judgment session’s newest operation after `judgment session running`', () => {
		const read: Operation = {
			kind: 'Read',
			target: 'docs/setup/prerequisites.md',
			at_ms: NOW - SECOND,
		}
		const activity = standing(STAGE.SESSION, MINUTE)

		expect(line_of({ activity, operations: { ...NONE, judgment: read } })).toBe(
			'judgment session running · Read docs/setup/prerequisites.md  0:01',
		)
	})

	it('reads each stage’s own session, never the other’s', () => {
		const operations = { ...NONE, judgment: bash('ls', SECOND) }

		expect(line_of({ activity: standing(STAGE.PLANNING, MINUTE), operations })).toBe(
			'planning 1:00 — pool empty',
		)
	})

	// The watcher's log runs on across runs, and the parent's transcript began before it planned.
	it('writes the stage and its time where the newest operation is older than the stage', () => {
		const operations = { ...NONE, judgment: bash(JUDGE, 5 * MINUTE) }
		const activity = standing(STAGE.SESSION, 72 * SECOND)

		expect(line_of({ activity, operations, waiting: 2 })).toBe(
			'judgment session running 1:12 — 2 waiting',
		)
	})
})

describe('run_board_now.line_of where no session’s operation is written', () => {
	const EVERY: SessionOperations = {
		lanes: [{ issue: 7, operation: bash(GATE, SECOND) }],
		owner: bash(PLAN, SECOND),
		judgment: bash(JUDGE, SECOND),
	}

	it.each([
		[STAGE.STARTING, 'starting session 0:42 — 1 running'],
		[STAGE.HANDING_OFF, 'handing off 0:42 — 1 running'],
		[STAGE.JUDGING, 'waiting on judgment 0:42 — 1 running'],
		[run_event_setup.opening_lane('8'), 'opening lane #8 0:42 — 1 running'],
		[run_event_setup.installing('8'), 'installing dependencies #8 0:42 — 1 running'],
		[run_event_setup.dispatching('8'), 'dispatching #8 0:42 — 1 running'],
	])('keeps `%s` as the stage, its time and why', (setup, line) => {
		const activity = standing(setup, 42 * SECOND)

		expect(line_of({ activity, operations: EVERY, running: 1, children: new Set([7]) })).toBe(line)
	})

	it('keeps the watch where nothing runs and the run is at no stage', () => {
		expect(line_of({ operations: EVERY })).toBe('watching 1:00 — pool empty')
	})

	it('keeps the newest thing an ended run did', () => {
		const activity = { ...MERGED, is_stopped: true }
		const line = line_of({ activity, operations: EVERY, running: 1, children: new Set([7]) })

		expect(line).toBe('#5 merged 1:00')
	})
})

describe('run_board_now.line_of — an operation’s words', () => {
	const CHILD = running([7], [{ issue: 7, operation: bash(GATE, SECOND) }])
	const PLANNING = {
		activity: standing(STAGE.PLANNING, MINUTE),
		operations: { ...NONE, owner: bash(PLAN, 0) },
	}

	it.each([line_of(CHILD), line_of(PLANNING)])('writes "%s" with no Japanese', (line) => {
		expect(line).not.toMatch(JAPANESE)
	})
})
