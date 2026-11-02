import type { LaneInfo } from '#scripts/lane/lane-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pickup_cli } from './run-pickup-cli'

const josh_run_mock = vi.hoisted(() => vi.fn())
const list_lanes_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/issue/session-cite', () => ({
	session_cite: { issue: (issue: string) => `#${issue}` },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { list_lanes: list_lanes_mock },
}))
vi.mock('#scripts/run/run-pickup-launch', () => ({
	run_pickup_launch: { launch: launch_mock },
}))

const OUTPUT_A = '/units/a.output'
const OUTPUT_B = '/units/b.output'
const WATCHER = 'watcher (start it in the background): pnpm josh run:progress --wait'
const NO_LANES = 'no open lane — nothing to pick up'
const LAUNCHED = '#21 launched — pid 4001'
const REFUSED = 'epic:next refused — boom'

function lane(issue: string, output: string | undefined): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output,
		dispatched_ms: undefined,
		is_stranded: false,
	}
}

function printed(): string {
	return vi
		.mocked(console.info)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	josh_run_mock.mockReset()
	list_lanes_mock.mockReset()
	launch_mock.mockReset()
})

describe('run:pickup with lanes recording a path', () => {
	it('asks run:liveness for every lane and prints the watcher line', async () => {
		list_lanes_mock.mockResolvedValue([lane('11', OUTPUT_A), lane('12', OUTPUT_B)])
		josh_run_mock.mockResolvedValueOnce({ code: 0, out: 'alive', err: '' })
		josh_run_mock.mockResolvedValueOnce({ code: 0, out: 'stopped', err: '' })

		expect(await run_pickup_cli.run([])).toBe(0)
		expect(josh_run_mock).toHaveBeenCalledWith(['run:liveness', '11', '--output', OUTPUT_A])
		expect(printed()).toBe(
			[
				'#11 liveness: alive',
				'#12 liveness: stopped',
				`${WATCHER} --output ${OUTPUT_A} --output ${OUTPUT_B}`,
			].join('\n'),
		)
	})

	it('prints undetermined when run:liveness printed nothing', async () => {
		list_lanes_mock.mockResolvedValue([lane('14', OUTPUT_A)])
		josh_run_mock.mockResolvedValue({ code: 1, out: '', err: 'boom' })

		await run_pickup_cli.run([])

		expect(printed()).toContain('#14 liveness: undetermined')
	})
})

describe('run:pickup with nothing to poll', () => {
	it('names a lane with no output path instead of polling it', async () => {
		list_lanes_mock.mockResolvedValue([lane('13', undefined)])

		expect(await run_pickup_cli.run([])).toBe(0)
		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(printed()).toBe(
			['#13 records no output path — set one with `pnpm josh lane:output 13 <path>`', WATCHER].join(
				'\n',
			),
		)
	})

	it('points a stranded lane at lane:prune instead of lane:output', async () => {
		list_lanes_mock.mockResolvedValue([{ ...lane('15', undefined), is_stranded: true }])

		await run_pickup_cli.run([])

		expect(printed()).toContain('#15 is stranded — close it with `pnpm josh lane:prune`')
	})

	it('says there is nothing to pick up with no open lane', async () => {
		list_lanes_mock.mockResolvedValue([])

		expect(await run_pickup_cli.run([])).toBe(0)
		expect(printed()).toBe(NO_LANES)
	})

	it.each(['--lanes', '0'])(
		'refuses %j, not an epic number, with the usage line',
		async (value) => {
			expect(await run_pickup_cli.run(['20', value])).toBe(1)
			expect(console.error).toHaveBeenCalledWith('Usage: josh run:pickup [<epic>...]')
			expect(list_lanes_mock).not.toHaveBeenCalled()
			expect(launch_mock).not.toHaveBeenCalled()
		},
	)
})

describe('run:pickup with epics named', () => {
	it('prints the launch lines before the lanes, listed after the launches', async () => {
		launch_mock.mockResolvedValue({ lines: [LAUNCHED], is_refused: false })
		list_lanes_mock.mockResolvedValue([lane('21', OUTPUT_A)])
		josh_run_mock.mockResolvedValue({ code: 0, out: 'alive', err: '' })

		expect(await run_pickup_cli.run(['20'])).toBe(0)
		expect(launch_mock).toHaveBeenCalledWith(['20'])
		expect(printed()).toBe(
			[LAUNCHED, '#21 liveness: alive', `${WATCHER} --output ${OUTPUT_A}`].join('\n'),
		)
	})

	it('exits 1 when the offer was refused, still reading the lanes back', async () => {
		launch_mock.mockResolvedValue({ lines: [REFUSED], is_refused: true })
		list_lanes_mock.mockResolvedValue([])

		expect(await run_pickup_cli.run(['20'])).toBe(1)
		expect(printed()).toBe([REFUSED, NO_LANES].join('\n'))
	})

	it('launches nothing with no epic named', async () => {
		list_lanes_mock.mockResolvedValue([])

		await run_pickup_cli.run([])

		expect(launch_mock).not.toHaveBeenCalled()
	})
})
