import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { describe, expect, it } from 'vitest'
import type { LaneEvent } from './run-board-lane-event'
import { run_board_now, type NowRead } from './run-board-now'
import { run_board_now_fixture } from './run-board-now-fixture'
import type { Operation } from './run-board-operation'
import type { SessionOperations } from './run-board-operation-read'
import type { RunActivity } from './run-board-status'

// joshuafolkken/kit#3757: the third line writes the newest operation of the session at work — a
// running child's, or the session a stage is the work of — and what it wrote before where there is
// none to write. joshuafolkken/kit#3767: a running child's newest event where it is newer than the
// child's newest operation, under its row's phase icon.

const SECOND = 1000
const MINUTE = 60 * SECOND
const NOW = Date.parse('2026-10-13T09:00:00.000Z')
const { STAGE } = run_event_setup
const JAPANESE = /[぀-ヿ一-鿿]/u
const GATE = 'pnpm josh gate'
const PLAN = 'pnpm josh backlog:plan'
const JUDGE = 'pnpm josh issue:read 5'
const SHIP = 'pnpm josh ship --detach --review'
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
	const line = run_board_now.line_of({
		now_ms: NOW,
		ended_ms: undefined,
		activity: MERGED,
		running: 0,
		waiting: 0,
		people: 0,
		...extra,
	})

	return run_board_now_fixture.drawn(line)
}

// Children `issues` running, each lane's newest operation as given.
function running(
	issues: ReadonlyArray<number>,
	lanes: SessionOperations['lanes'],
): Partial<NowRead> {
	return { running: issues.length, children: new Set(issues), operations: { ...NONE, lanes } }
}

// The running children's newest events, by issue.
function with_events(
	read: Partial<NowRead>,
	events: ReadonlyArray<readonly [number, LaneEvent]>,
): Partial<NowRead> {
	return { ...read, activity: { ...MERGED, lane_events: new Map(events) } }
}

function event(words: string, phase: LaneEvent['phase'], age_ms: number): LaneEvent {
	return { phase, words, at_ms: NOW - age_ms }
}

describe('run_board_now.line_of while a child runs', () => {
	it('writes the child’s issue and its newest operation under 🔧, and how long ago', () => {
		const lanes = [{ issue: 7, operation: bash('pnpm josh test:related', 4 * SECOND) }]
		const line = line_of(running([7], lanes))

		expect(line).toBe('0:00:04 🔧 #7 · Bash pnpm josh test:related')
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

		expect(line_of(running([7, 8], lanes))).toBe('0:00:02 🔧 #8 · Edit scripts/lane/lane-open.ts')
	})

	it('writes a tool pointed at nothing by its name alone', () => {
		const lanes = [
			{ issue: 7, operation: { kind: 'Agent', target: undefined, at_ms: NOW - SECOND } },
		]

		expect(line_of(running([7], lanes))).toBe('0:00:01 🔧 #7 · Agent')
	})

	it('leaves out a lane whose child is not running, however new its operation', () => {
		const lanes = [
			{ issue: 7, operation: bash(GATE, MINUTE) },
			{ issue: 9, operation: bash('pnpm josh ship', SECOND) },
		]

		expect(line_of(running([7], lanes))).toBe('0:01:00 🔧 #7 · Bash pnpm josh gate')
	})
})

describe('run_board_now.line_of — a child’s operation against its event', () => {
	const SHIPPING = running([7], [{ issue: 7, operation: bash(SHIP, 166 * SECOND) }])

	it('writes the event, in its words and its row’s phase icon, where it is the newer', () => {
		const read = with_events(SHIPPING, [[7, event('ship gate', 'gate', SECOND)]])

		expect(line_of(read)).toBe('0:00:01 🚦 #7 · ship gate')
	})

	it('writes the operation where it is the newer', () => {
		const read = with_events(SHIPPING, [[7, event('implement', 'implement', 5 * MINUTE)]])

		expect(line_of(read)).toBe('0:02:46 🔧 #7 · Bash pnpm josh ship --detach --review')
	})

	it('writes the operation where the two are as new', () => {
		const read = with_events(SHIPPING, [[7, event('ship gate', 'gate', 166 * SECOND)]])

		expect(line_of(read)).toContain('🔧')
	})

	it('writes the newest across two lanes, one lane’s event over the other’s operation', () => {
		const lanes = [
			{ issue: 7, operation: bash(GATE, 9 * SECOND) },
			{ issue: 8, operation: bash(SHIP, MINUTE) },
		]
		const read = with_events(running([7, 8], lanes), [[8, event('ship review', 'review', SECOND)]])

		expect(line_of(read)).toBe('0:00:01 👀 #8 · ship review')
	})

	it('draws a failed stage under 💥', () => {
		const read = with_events(SHIPPING, [[7, event('ship gate failed', 'failed', SECOND)]])

		expect(line_of(read)).toBe('0:00:01 💥 #7 · ship gate failed')
	})

	it('leaves out the event of a child that is not running', () => {
		const read = with_events(SHIPPING, [[9, event('ship gate', 'gate', SECOND)]])

		expect(line_of(read)).toContain('🔧 #7')
	})

	it('writes the event where no operation could be read', () => {
		const read = with_events(running([7], []), [[7, event('implement', 'implement', MINUTE)]])

		expect(line_of(read)).toBe('0:01:00 🔨 #7 · implement')
	})
})

describe('run_board_now.line_of while a child runs — where nothing is to be read', () => {
	it('counts the children where no running child’s log or event gave anything', () => {
		expect(line_of(running([7], []))).toBe('- 🔄 1 running')
		expect(line_of({ running: 2 })).toBe('- 🔄 2 running')
	})

	it('reads an operation dated ahead of the clock as done now', () => {
		const lanes = [{ issue: 7, operation: bash('ls', -3 * SECOND) }]

		expect(line_of(running([7], lanes))).toBe('0:00:00 🔧 #7 · Bash ls')
	})
})

describe('run_board_now.line_of at a stage a session works on', () => {
	it('writes the parent’s newest operation after `planning`, under the stage’s icon', () => {
		const operations = { ...NONE, owner: bash(PLAN, 3 * SECOND) }
		const activity = standing(STAGE.PLANNING, MINUTE)

		expect(line_of({ activity, operations, waiting: 2 })).toBe(
			'0:00:03 📝 planning · Bash pnpm josh backlog:plan',
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
			'0:00:01 💭 judgment session running · Read docs/setup/prerequisites.md',
		)
	})

	it('reads each stage’s own session, never the other’s', () => {
		const operations = { ...NONE, judgment: bash('ls', SECOND) }

		expect(line_of({ activity: standing(STAGE.PLANNING, MINUTE), operations })).toBe(
			'0:01:00 📝 planning — pool empty',
		)
	})

	// The watcher's log runs on across runs, and the parent's transcript began before it planned.
	it('writes the stage and its time where the newest operation is older than the stage', () => {
		const operations = { ...NONE, judgment: bash(JUDGE, 5 * MINUTE) }
		const activity = standing(STAGE.SESSION, 72 * SECOND)

		expect(line_of({ activity, operations, waiting: 2 })).toBe(
			'0:01:12 💭 judgment session running — 2 waiting',
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
		[STAGE.STARTING, '0:00:42 🚀 starting session — 1 running'],
		[STAGE.HANDING_OFF, '0:00:42 🤝 handing off — 1 running'],
		[STAGE.JUDGING, '0:00:42 🤔 waiting on judgment — 1 running'],
		[run_event_setup.opening_lane('8'), '0:00:42 🚪 opening lane #8 — 1 running'],
		[run_event_setup.installing('8'), '0:00:42 📥 installing dependencies #8 — 1 running'],
		[run_event_setup.dispatching('8'), '0:00:42 📤 dispatching #8 — 1 running'],
	])('keeps `%s` as the stage, its time and why', (setup, line) => {
		const activity = standing(setup, 42 * SECOND)

		expect(line_of({ activity, operations: EVERY, running: 1, children: new Set([7]) })).toBe(line)
	})

	it('keeps the watch where nothing runs and the run is at no stage', () => {
		expect(line_of({ operations: EVERY })).toBe('0:01:00 🔭 watching — pool empty')
	})

	it('keeps the newest thing an ended run did', () => {
		const activity = { ...MERGED, is_stopped: true }
		const line = line_of({ activity, operations: EVERY, running: 1, children: new Set([7]) })

		expect(line).toBe('0:01:00 🏁 #5 merged')
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
