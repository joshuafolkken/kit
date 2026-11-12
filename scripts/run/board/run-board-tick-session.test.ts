import { stripVTControlCharacters } from 'node:util'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import { run_board_tick } from './run-board-tick'

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const WAITING = 5
const HEADER_LINES = 3
const EVENTS = [
	{ pos: 1, at: new Date(START).toISOString(), kind: 'drain', text: 'backlog drained' },
	{
		pos: 2,
		at: new Date(START).toISOString(),
		kind: 'setup',
		text: run_event_setup.STAGE.SESSION,
	},
]

function header(frame = ''): string {
	return stripVTControlCharacters(frame).split('\n').slice(0, HEADER_LINES).join('\n')
}

function waiting_plan(): ReturnType<typeof plan_titled> {
	const plan = plan_titled('waiting')
	const children = Array.from({ length: WAITING }, (_, index) => ({
		number: index + 1,
		repo: 'joshuafolkken/kit',
		state: 'OPEN' as const,
		labels: [],
		blocked_by: [],
	}))

	return { ...plan, waves: { waves: [children], unreached: [] } }
}

describe('run_board_tick retrospective activity', () => {
	it('keeps the supervisor-owned retrospective unit running without a judgment session', async () => {
		const events = EVENTS.map((event) => ({
			...event,
			text: event.kind === 'setup' ? run_event_setup.STAGE.RETROSPECTIVE : event.text,
		}))
		const local = { ...LOCAL, events, is_session_active: false }
		const { ports, frames } = harness(local, [waiting_plan()])

		await tick(FRESH_STATE, ports)
		expect(header(frames[0])).toMatch(/^▶ backlogrun.*\n.*\n.*⠋/u)
		expect(header(frames[0])).toContain('🔍 retrospective')
	})
})

describe('run_board_tick judgment session activity', () => {
	it('pauses after the session exits without a new setup event', async () => {
		const local = { ...LOCAL, events: EVENTS, is_session_active: true }
		const { ports, frames, read_local, clock } = harness(local, [waiting_plan()])
		const state = await tick(FRESH_STATE, ports)

		read_local.mockResolvedValue({ ...local, is_session_active: false })
		clock.now_ms += run_board_gather.LOCAL_READ_MS
		await tick(state, ports)
		expect(header(frames[0])).toMatch(/^▶ backlogrun.*\n.*\n.*⠋/u)
		expect(header(frames[1])).toMatch(/^⏸ backlogrun/u)
		expect(header(frames[1])).toContain('🔄 0  ⏳ 5')
		expect(header(frames[1])).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u)
	})
	it('resumes when judgment work starts again on the same stage', async () => {
		const local = { ...LOCAL, events: EVENTS, is_session_active: false }
		const { ports, frames, read_local, clock } = harness(local, [waiting_plan()])
		const state = await tick(FRESH_STATE, ports)

		read_local.mockResolvedValue({ ...local, is_session_active: true })
		clock.now_ms += run_board_gather.LOCAL_READ_MS
		await tick(state, ports)
		expect(header(frames[0])).toMatch(/^⏸ backlogrun/u)
		expect(header(frames[1])).toMatch(/^▶ backlogrun/u)
		expect(header(frames[1])).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u)
	})
})
