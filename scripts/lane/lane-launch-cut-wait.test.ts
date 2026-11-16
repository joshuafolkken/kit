import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const find_open_lane_mock = vi.hoisted(() => vi.fn())
const is_vacant_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: find_open_lane_mock },
}))
vi.mock('#scripts/lane/lane-vacant', () => ({ lane_vacant: { is_vacant: is_vacant_mock } }))
vi.mock('./lane-launch-admission', () => ({
	lane_launch_admission: {
		launch: async (context: unknown, run: (context: unknown) => Promise<unknown>) =>
			await run(context),
	},
}))

const { lane_launch_cli } = await import('./lane-launch-cli')

const ISSUE = '7654'
const DIR = '/lanes/7654'
const OPEN = 'lane:open'
const DISPATCH = 'lane:dispatch'
const CLOSE = 'lane:close'
const OPENED_LANE = { issue: ISSUE, directory: DIR, is_stranded: false, output: undefined }
const CUT_REFUSAL = { code: lane_dispatch_dependency.WAIT_EXIT_CODE, out: '' }

// The subcommand that answers with the cut-session refusal; every other one succeeds.
function refuse_at(refusing: string): void {
	josh_run_mock.mockImplementation(async (args: ReadonlyArray<string>) =>
		args[0] === refusing ? CUT_REFUSAL : { code: 0, out: DIR },
	)
}

function subcommands(): Array<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>)[0] ?? '')
}

beforeEach(() => {
	josh_run_mock.mockReset()
	find_open_lane_mock.mockReset().mockResolvedValue(undefined)
	is_vacant_mock.mockReset().mockResolvedValue(true)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(run_event_setup, 'emit').mockReset().mockResolvedValue()
})

// joshuafolkken/kit#7662: a launch overlapping a cut's hand-off waits for the successor, unparked.
describe('lane_launch_cli.launch_lane — a cut-session refusal', () => {
	it('reads a refused lane:dispatch as waiting and closes the lane it opened', async () => {
		refuse_at(DISPATCH)
		find_open_lane_mock.mockResolvedValueOnce(undefined).mockResolvedValue(OPENED_LANE)

		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: undefined })).toStrictEqual({
			kind: 'waiting',
		})
		expect(subcommands()).toStrictEqual([OPEN, DISPATCH, CLOSE])
	})

	it('reads a refused lane:open as waiting, not unopened, and dispatches nothing', async () => {
		refuse_at(OPEN)

		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: undefined })).toStrictEqual({
			kind: 'waiting',
		})
		expect(subcommands()).toStrictEqual([OPEN])
	})
})
