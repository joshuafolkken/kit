import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_adopt } from './backlog-drive-adopt'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#4373: a lane the parent dispatched itself with `lane:launch` was never held by
// `backlog:drive`, so its child shipped and merged while the run recorded no merge until `--end`.

vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { list_lanes: vi.fn() } }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: vi.fn(), emit: vi.fn() },
}))

const { CONFIG, FIRST_CHILD, SECOND_CHILD, harness, offer, state } = backlog_drive_fixture
const AT = '2026-10-20T19:48:47.000Z'
const OUTSIDE = '4335'
const STRANDED = '4336'
const SETTLED = '4337'

function lane(issue: string, is_stranded = false): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded,
	}
}

function event(kind: string, text: string, pos: number): RunEvent {
	return { pos, at: AT, kind, text }
}

const { CHILD_LAUNCH, MERGE, NOTE } = run_event_stream.EVENT_KIND

beforeEach(() => {
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([
		event(CHILD_LAUNCH, `#${FIRST_CHILD} dispatched`, 1),
		event(CHILD_LAUNCH, `#${OUTSIDE} dispatched`, 2),
		event(CHILD_LAUNCH, `#${STRANDED} dispatched`, 3),
		event(CHILD_LAUNCH, `#${SETTLED} dispatched`, 4),
		event(MERGE, `#${SETTLED} merged`, 5),
	])
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([
		lane(FIRST_CHILD),
		lane(OUTSIDE),
		lane(STRANDED, true),
		lane(SETTLED),
		lane(SECOND_CHILD),
	])
})

describe('backlog_drive.run_loop — a lane launched outside the loop', () => {
	it('records the merge of a child the loop did not launch once it finishes', async () => {
		const { ports, calls } = harness({
			adoptable: [OUTSIDE],
			finished: [OUTSIDE],
			offers: [offer('wait'), offer('stop')],
		})
		const end = await backlog_drive.run_loop(state(), CONFIG, ports)

		expect(calls).toStrictEqual([`merge ${OUTSIDE}`, 'offer', 'offer', 'finish'])
		expect(end.reason).toBe('stop')
	})

	it('adopts nothing on a throttled pass, which reads no event stream', async () => {
		const { ports, calls } = harness({ adoptable: [OUTSIDE], finished: [OUTSIDE] })
		const result = await backlog_drive.run_pass(state(), false, ports)

		expect(calls).toStrictEqual([])
		expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([])
	})

	it('adopts nothing once the run is stopping, so an unparked failure is not collected twice', async () => {
		const { ports, calls } = harness({
			adoptable: [OUTSIDE],
			finished: [FIRST_CHILD, OUTSIDE],
		})
		const stopping = { ...state([FIRST_CHILD]), is_stopping: true }
		const result = await backlog_drive.run_pass(stopping, true, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`])
		expect(result.kind).toBe('end')
	})
})

describe('backlog_drive.run_pass — an adopted lane left unmerged after its ship', () => {
	it('hands the child to run:merge on the pass that adopts it, for its unmerged reason to be recorded', async () => {
		const { ports, calls } = harness({
			adoptable: [OUTSIDE],
			finished: [OUTSIDE],
			unmerged: [OUTSIDE],
		})
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(calls.slice(0, 1)).toStrictEqual([`merge ${OUTSIDE}`])
		expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([])
	})
})

describe('backlog_drive_adopt.adoptable', () => {
	it('returns the unsettled lanes, stranded ones aside, this run launched that the loop does not hold', async () => {
		await expect(backlog_drive_adopt.adoptable([FIRST_CHILD])).resolves.toStrictEqual([OUTSIDE])
	})

	it('puts each adopted lane on the stream with why it was adopted', async () => {
		await backlog_drive_adopt.adoptable([FIRST_CHILD])

		expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(
			NOTE,
			`#${OUTSIDE} adopted by backlog:drive: its lane was launched outside the loop`,
		)
	})

	it('adopts nothing when the loop already holds every active lane', async () => {
		await expect(backlog_drive_adopt.adoptable([FIRST_CHILD, OUTSIDE])).resolves.toStrictEqual([])
		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})
