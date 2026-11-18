import { readFileSync } from 'node:fs'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { CueName } from './run-board-sound-cues'
import { run_board_sound_transition, type SoundSnapshot } from './run-board-sound-transition'

const { EMPTY_LAYOUT, NOW, header } = run_board_render_fixture
const { cue_of, snapshot_of } = run_board_sound_transition

interface Frame {
	rows: ReadonlyArray<BoardRow>
	extra?: Partial<BoardHeader>
	events?: ReadonlyArray<Pick<RunEvent, 'kind'>>
}

interface Case {
	name: string
	before: Frame
	after: Frame
	cue: CueName | undefined
}

function row(number: number, state: BoardRow['state'], track?: ReadonlyArray<Phase>): BoardRow {
	const status = track === undefined ? undefined : { state, track }

	return { number, title: undefined, kind: undefined, state, status, waits: [] }
}

function snapshot(frame: Frame): SoundSnapshot | undefined {
	const layout = { ...EMPTY_LAYOUT, active: frame.rows }

	return snapshot_of(header({ layout, ...frame.extra }), frame.events ?? [])
}

function cue_between(before: Frame, after: Frame): CueName | undefined {
	return cue_of(snapshot(before), snapshot(after))
}

const RUNNING = row(1, 'running', ['implement'])
// A second lane still running, so a row waiting on a person does not leave the run waiting on one.
const OTHER_RUNNING = row(2, 'running', ['implement'])
const STOPPED_RUN: Partial<BoardHeader> = { activity: { last_event_ms: NOW, is_stopped: true } }
const DRAINED: Frame = { rows: [row(1, 'merged')], extra: STOPPED_RUN, events: [{ kind: 'drain' }] }
const HOLD = { reset_ms: NOW, parked: 1 }
const OUTAGE = { from_ms: NOW, down_ms: NOW }

const SOUNDING: ReadonlyArray<Case> = [
	{ name: 'a launch', before: { rows: [] }, after: { rows: [RUNNING] }, cue: 'launch' },
	{
		name: 'a restart from waiting',
		before: { rows: [row(1, 'waiting')] },
		after: { rows: [RUNNING] },
		cue: 'launch',
	},
	{
		name: 'a merge',
		before: { rows: [RUNNING] },
		after: { rows: [row(1, 'merged')] },
		cue: 'lane-end',
	},
	{
		name: 'a done lane',
		before: { rows: [RUNNING] },
		after: { rows: [row(1, 'done')] },
		cue: 'lane-end',
	},
	{ name: 'a drain', before: { rows: [row(1, 'merged')] }, after: DRAINED, cue: 'drain' },
	{
		name: 'a human review beside a running lane',
		before: { rows: [RUNNING, OTHER_RUNNING] },
		after: { rows: [row(1, 'human'), OTHER_RUNNING] },
		cue: 'human',
	},
	{
		name: 'a park',
		before: { rows: [RUNNING] },
		after: { rows: [row(1, 'parked')] },
		cue: 'human',
	},
	{
		name: 'a stopped lane',
		before: { rows: [RUNNING] },
		after: { rows: [row(1, 'stopped')] },
		cue: 'alert',
	},
	{
		name: 'a failed ship',
		before: { rows: [RUNNING] },
		after: { rows: [row(1, 'running', ['implement', 'ship', 'failed'])] },
		cue: 'alert',
	},
	{
		name: 'a usage-limit hold',
		before: { rows: [RUNNING] },
		after: { rows: [RUNNING], extra: { quota_hold: HOLD } },
		cue: 'alert',
	},
	{
		name: 'an outage',
		before: { rows: [RUNNING] },
		after: {
			rows: [RUNNING],
			extra: { activity: { last_event_ms: NOW, is_stopped: false, outage: OUTAGE } },
		},
		cue: 'alert',
	},
	{
		name: 'the run stopping',
		before: { rows: [row(1, 'merged')] },
		after: { rows: [row(1, 'merged')], extra: STOPPED_RUN },
		cue: 'alert',
	},
	{
		name: 'the run left waiting on a person',
		before: { rows: [row(1, 'parked'), row(2, 'running')] },
		after: { rows: [row(1, 'human'), row(2, 'merged')] },
		cue: 'alert',
	},
	{
		name: 'an outage opening under a usage-limit hold',
		before: { rows: [RUNNING], extra: { quota_hold: HOLD } },
		after: {
			rows: [RUNNING],
			extra: {
				quota_hold: HOLD,
				activity: { last_event_ms: NOW, is_stopped: false, outage: OUTAGE },
			},
		},
		cue: 'alert',
	},
]

const SILENT: ReadonlyArray<Case> = [
	{
		name: 'a red CI',
		before: { rows: [RUNNING] },
		after: {
			rows: [RUNNING],
			extra: { activity: { last_event_ms: NOW, is_stopped: false, pr_checks: new Map() } },
		},
		cue: undefined,
	},
	{
		name: 'a withdrawal',
		before: { rows: [RUNNING] },
		after: { rows: [row(1, 'withdrawn')] },
		cue: undefined,
	},
	{
		name: 'a pause',
		before: { rows: [RUNNING] },
		after: { rows: [row(1, 'paused')] },
		cue: undefined,
	},
	{
		name: 'a phase moving on',
		before: { rows: [RUNNING] },
		after: { rows: [row(1, 'running', ['implement', 'ship'])] },
		cue: undefined,
	},
	{
		name: 'an unchanged frame',
		before: { rows: [RUNNING] },
		after: { rows: [RUNNING] },
		cue: undefined,
	},
]

const RATIONALE = new URL(
	'../../../docs/maintainers/josh-commands-run-rationale.md',
	import.meta.url,
)
const SCENE_HEADER = ['Scene', 'Cue']
const SILENT_CELL = '—'

function cells_of(line: string): Array<string> {
	return line
		.split('|')
		.slice(1, -1)
		.map((cell) => cell.trim())
}

// The rationale's scene table, header and separator left out.
function scene_table(): Array<Array<string>> {
	const rows = readFileSync(RATIONALE, 'utf8')
		.split('\n')
		.map((line) => (line.startsWith('|') ? cells_of(line) : undefined))
	const start = rows.findIndex((cells) => cells?.join('|') === SCENE_HEADER.join('|'))
	const body = rows.slice(start + 1)
	const end = body.indexOf(undefined)

	return body.slice(0, end).filter((cells) => !cells?.[0]?.startsWith('-')) as Array<Array<string>>
}

function scene_row({ name, cue }: Case): Array<string> {
	return [name, cue === undefined ? SILENT_CELL : `\`${cue}\``]
}

describe('run_board_sound_transition.cue_of — the cue a frame sounds against the one before', () => {
	it('matches the scene table the run:board rationale documents (ac-997f4ab4)', () => {
		expect(scene_table()).toEqual([...SOUNDING, ...SILENT].map((entry) => scene_row(entry)))
	})

	it.each(SOUNDING)('sounds $cue for $name (ac-7c8a71a4)', ({ before, after, cue }) => {
		expect(cue_between(before, after)).toBe(cue)
	})

	it.each(SILENT)('sounds nothing for $name (ac-1f4b4bc4)', ({ before, after }) => {
		expect(cue_between(before, after)).toBeUndefined()
	})

	it('sounds the alert alone when information, a person and a fault arrive at once (ac-2dd62ce1)', () => {
		const before = { rows: [row(1, 'waiting'), row(2, 'running'), row(3, 'running')] }
		const after = { rows: [row(1, 'running'), row(2, 'human'), row(3, 'stopped')] }

		expect(cue_between(before, after)).toBe('alert')
	})

	it('sounds nothing on the first frame, even one waiting on a person and stopped (ac-b6e7301d)', () => {
		const current = snapshot({ rows: [row(1, 'human'), row(2, 'stopped')], extra: STOPPED_RUN })

		expect(cue_of(undefined, current)).toBeUndefined()
	})

	it('sounds nothing against a frame read before the layout', () => {
		const unread = snapshot_of(header({ layout: undefined }), [])

		expect(cue_of(unread, snapshot({ rows: [RUNNING] }))).toBeUndefined()
	})
})
