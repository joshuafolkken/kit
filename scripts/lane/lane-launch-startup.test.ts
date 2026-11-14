import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_startup } from '#scripts/run/startup/run-startup'
import type { StartupEntry } from '#scripts/run/startup/run-startup-schema'
import { run_startup_store } from '#scripts/run/startup/run-startup-store'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const josh_run = vi.hoisted(() => vi.fn())
const install = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run } }))
vi.mock('execa', () => ({ execa: install }))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: async () => undefined },
}))
vi.mock('./lane-launch-admission', () => ({
	lane_launch_admission: {
		launch: async (context: unknown, run: (context: unknown) => Promise<unknown>) =>
			await run(context),
	},
}))

const { lane_launch_cli } = await import('./lane-launch-cli')
const SCOPE = { run: 'startup-run', issue: '7422', attempt: 'startup-attempt' }
const rows: Array<StartupEntry> = []
const CREATION = 'lane creation'
const REINSTALL = 'dependency reinstall'
const DISPATCH = 'worker dispatch'
const DISPATCH_COMMAND = 'lane:dispatch'

beforeEach(() => {
	rows.length = 0
	josh_run.mockReset().mockResolvedValue({ code: 0, out: '/lane' })
	install.mockReset().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
	vi.spyOn(run_event_setup, 'emit').mockResolvedValue()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(run_startup_store, 'record').mockImplementation(async (row) => {
		rows.push(row)
	})
})

afterEach(() => vi.restoreAllMocks())

async function launch(): Promise<unknown> {
	return await run_startup.within(
		SCOPE,
		async () => await lane_launch_cli.launch_lane({ issue: SCOPE.issue, stash: 'latest' }),
	)
}

function summaries(): Array<unknown> {
	return run_startup_store.summarize(rows).map(({ start, status, elapsed_ms }) => ({
		phase: start.phase,
		status,
		elapsed_ms,
	}))
}

it('records distinct successful stages and inherits the run, issue and attempt', async () => {
	await expect(launch()).resolves.toMatchObject({ kind: 'launched' })
	expect(summaries()).toEqual(
		[CREATION, REINSTALL, DISPATCH].map((phase) => ({
			phase,
			status: 'done',
			elapsed_ms: expect.any(Number),
		})),
	)
	expect(rows.length).toBeGreaterThan(0)
	expect(
		rows.every(
			(row) => row.run === SCOPE.run && row.issue === SCOPE.issue && row.attempt === SCOPE.attempt,
		),
	).toBe(true)
})

it.each([
	['lane:open', CREATION],
	['install', REINSTALL],
	[DISPATCH_COMMAND, DISPATCH],
])('records a failed %s and stops subsequent stages', async (command, phase) => {
	if (command === 'install') install.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' })
	josh_run.mockImplementation(async (argv: ReadonlyArray<string>) => ({
		code: argv[0] === command ? 1 : 0,
		out: '/lane',
	}))
	await launch()
	const phases = run_startup_store.summarize(rows)

	expect(phases.at(-1)).toMatchObject({
		start: { phase },
		status: 'failed',
		elapsed_ms: expect.any(Number),
	})
	expect(phases.map((row) => row.start.phase)).toEqual(
		[CREATION, REINSTALL, DISPATCH].slice(0, [CREATION, REINSTALL, DISPATCH].indexOf(phase) + 1),
	)
})

it('records a dependency refusal as waiting without changing the launch outcome', async () => {
	josh_run.mockImplementation(async (argv: ReadonlyArray<string>) => ({
		code: argv[0] === DISPATCH_COMMAND ? lane_dispatch_dependency.WAIT_EXIT_CODE : 0,
		out: '/lane',
	}))
	await expect(launch()).resolves.toEqual({ kind: 'waiting' })
	expect(run_startup_store.summarize(rows).at(-1)).toMatchObject({
		start: { phase: DISPATCH },
		status: 'waiting',
		elapsed_ms: expect.any(Number),
	})
})
