import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_launch_cli } from '#scripts/lane/lane-launch-cli'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_sampler } from '#scripts/lane/lane-sampler'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_merge_driver } from '#scripts/run/merge/run-merge-driver'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_args } from './backlog-drive-args'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_owner } from './backlog-drive-owner'

const ACTIVE = '2026-09-24T00:00:00.000Z'
const WINDOW_MINUTES = 9

it.each([false, true])(
	'clears pending admission on driver exit, throwing=%s',
	async (should_throw) => {
		const keep = vi.spyOn(lane_launch_cli, 'keep_pending')
		const read = vi.spyOn(run_carry, 'repository_directory')

		vi.spyOn(lane_sampler, 'start').mockReturnValue(vi.fn())
		vi.spyOn(console, 'info').mockImplementation(vi.fn())
		if (should_throw) read.mockRejectedValue(new Error('git died'))
		else read.mockResolvedValue(undefined)
		await backlog_drive_cli.run(['--owner', '4242'])

		expect(keep).toHaveBeenCalledWith([])
	},
)

const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-09-23T23:00:00.000Z',
	merged: 3,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

describe('backlog_drive_cli.parse', () => {
	it('reads the owner, the forwarded budgets, the lists and the window', () => {
		const context = backlog_drive_cli.parse([
			'--owner',
			'4242',
			'--max',
			'5',
			'--exclude',
			'2400,2401',
			'--await',
			'2500',
			'--window',
			String(WINDOW_MINUTES),
		])

		expect(context).toStrictEqual({
			owner: '4242',
			active: undefined,
			forwarded: ['--max', '5'],
			exclude: ['2400', '2401'],
			awaited: ['2500'],
			window_ms: WINDOW_MINUTES * MS_PER_MINUTE,
			window: String(WINDOW_MINUTES),
			is_only: false,
			stopped: undefined,
		})
	})
})

// joshuafolkken/kit#5504: an omitted `--owner` is the pid the calling session exports.
describe('backlog_drive_cli.parse omitted owner', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads the owner from the session environment', () => {
		vi.spyOn(agent_session_environment, 'own_session_pid').mockReturnValue(4242)

		expect(backlog_drive_cli.parse([])?.owner).toBe('4242')
	})

	it('refuses where the session exports none', () => {
		vi.spyOn(agent_session_environment, 'own_session_pid').mockReturnValue(undefined)

		expect(backlog_drive_cli.parse([])).toBeUndefined()
	})

	it('marks the owner optional in its usage', () => {
		expect(backlog_drive_args.USAGE).toContain('backlog:drive [--owner <pid>]')
	})
})

it.each([
	[['--owner', 'abc']],
	[['--owner', '1', '--exclude', '2400,--evil']],
	[['--owner', '1', '--exclude', '0']],
	[['--owner', '1', '--await', '2400,0']],
	[['--owner', '1', '--stopped', '0']],
	[['--owner', '1', '--max', 'many']],
	[['--owner', '1', '--window', 'soon']],
	[['--owner', '1', '--unknown', 'x']],
])('refuses %j', (argv) => {
	expect(backlog_drive_cli.parse(argv)).toBeUndefined()
})

describe('backlog_drive_cli.offer_argv', () => {
	it('takes started and merged from the carry record and the rest from the loop state', () => {
		const state = {
			...backlog_drive.initial_state(['2500'], ACTIVE),
			exclude: ['2400'],
			retries: 1,
		}

		expect(backlog_drive_cli.offer_argv(state, CARRY, ['--idle', '0'])).toStrictEqual([
			'backlog:offer',
			'--json',
			'--started',
			CARRY.started_at,
			'--active',
			ACTIVE,
			'--merged',
			'3',
			'--running',
			'1',
			'--retries',
			'1',
			'--exclude',
			'2400,2500',
			'--idle',
			'0',
		])
	})

	it('never offers a child still in flight, even one GitHub already reads unclaimed', () => {
		const state = backlog_drive.initial_state(['2500', '2501'], ACTIVE)
		const argv = backlog_drive_cli.offer_argv(state, CARRY, [])

		expect(argv.slice(argv.indexOf('--exclude'))).toStrictEqual(['--exclude', '2500,2501'])
	})
})

// joshuafolkken/kit#4102: each merge runs `run:merge --driver` as its own process, so a fix merged
// after the loop started is the code that decides the child.
const MERGED: MergeResult = { token: '2600', code: 0, outcome: 'merged', is_offer: true }

function arrange_merge(out: string, code = 0): MockInstance<typeof josh_command.josh_run> {
	vi.spyOn(backlog_drive_owner, 'assert_current').mockResolvedValue(CARRY)
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)
	vi.spyOn(backlog_drive_named, 'mark_done').mockResolvedValue()

	return vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code, out })
}

describe('backlog_drive_cli.merge', () => {
	it('runs run:merge --driver as a child process and reads its printed result', async () => {
		const run = arrange_merge(`progress\n${run_merge_driver.print(MERGED)}`)

		await expect(backlog_drive_cli.merge('2500', '4242')).resolves.toStrictEqual(MERGED)
		expect(run).toHaveBeenCalledWith(
			['run:merge', '2500', '--owner', '4242', '--driver'],
			expect.any(Boolean),
		)
		vi.restoreAllMocks()
	})

	it('answers no token when the child process printed no result', async () => {
		arrange_merge('crashed', 1)

		await expect(backlog_drive_cli.merge('2500', '4242')).resolves.toStrictEqual({
			token: '',
			code: 1,
			is_offer: true,
			outcome: 'unresolved',
		})
		vi.restoreAllMocks()
	})
})

describe('backlog_drive_cli output', () => {
	it('reads the offer backlog:offer --json prints', () => {
		const out = JSON.stringify({ offer: { verdict: 'run', issues: ['2500'], retries: 0 } })

		expect(backlog_drive_cli.to_offer(out)).toStrictEqual({
			verdict: 'run',
			issues: ['2500'],
			retries: 0,
		})
		expect(backlog_drive_cli.to_offer('not json')).toBeUndefined()
	})
})

// joshuafolkken/kit#4396: the `run:solo` cause reaches the hold the driver records.
describe('backlog_drive_cli output — the offer’s cause', () => {
	it('reads the cause an offer that started nothing names', () => {
		const offer = { verdict: 'watch', issues: [], retries: 0, answer: 'blocked', cause: 'solo' }

		expect(backlog_drive_cli.to_offer(JSON.stringify({ offer }))?.cause).toBe('solo')
	})

	// joshuafolkken/kit#4513: the issues a chain wait named survive the read into the hold.
	it('reads the issues a chain or gate wait waited on', () => {
		const offer = { verdict: 'watch', issues: [], retries: 0, cause: 'chain', waiting: [4496] }

		expect(backlog_drive_cli.to_offer(JSON.stringify({ offer }))?.waiting).toStrictEqual([4496])
	})

	// joshuafolkken/kit#5518: an offer that held an untriaged candidate back owes the judgment.
	it('reads the judgment an offer owes beside its candidates', () => {
		const offer = { verdict: 'run', issues: ['12'], retries: 0, is_judgment_owed: true }

		expect(backlog_drive_cli.to_offer(JSON.stringify({ offer }))?.is_judgment_owed).toBe(true)
	})
})

describe('backlog_drive_cli output — the rest', () => {
	it('prints the hand-back with its token and child', () => {
		expect(backlog_drive_cli.end_line({ reason: 'merge', token: 'over', issue: '2493' })).toBe(
			'merge over #2493',
		)
		expect(
			backlog_drive_cli.end_line({
				reason: 'stop',
				token: 'stop',
				issue: undefined,
				detail: 'max',
			}),
		).toBe('stop max')
		expect(backlog_drive_cli.end_line({ reason: 'stop', token: 'stop', issue: undefined })).toBe(
			'stop',
		)
	})

	it('prints a resume line that carries every collected child', () => {
		const context = backlog_drive_cli.parse(['--owner', '4242', '--exclude', '2400', '--idle', '0'])
		const state = { ...backlog_drive.initial_state([], ACTIVE), exclude: ['2400', '2401'] }

		expect(context && backlog_drive_cli.resume_line(state, context)).toBe(
			`resume: --owner 4242 --active ${ACTIVE} --idle 0 --exclude 2400,2401`,
		)
	})
})

describe('backlog_drive_cli — a merge stop across a hand-back', () => {
	it('carries a merge stop on the resume line and reads it back', () => {
		const context = backlog_drive_cli.parse(['--owner', '4242'])
		const state = backlog_drive.merge_stopped('2401', backlog_drive.initial_state([], ACTIVE))
		const line = context && backlog_drive_cli.resume_line(state, context)

		expect(line).toBe(`resume: --owner 4242 --active ${ACTIVE} --stopped 2401`)
		expect(backlog_drive_cli.parse(['--owner', '4242', '--stopped', '2401'])?.stopped).toBe('2401')
		expect(backlog_drive_cli.parse(['--owner', '4242', '--stopped', 'x'])).toBeUndefined()
	})
})

// joshuafolkken/kit#4365: a child withdrawn while the drive was handed back is never collected by the
// resumed drive, so the resume line alone would offer it again in the same run.
describe('backlog_drive_cli.seeded_state — a withdrawal across a hand-back', () => {
	it('excludes a child the stream reads withdrawn beside the resume line exclusion', () => {
		const context = backlog_drive_cli.parse(['--owner', '4242', '--exclude', '2400'])
		const seeded = { lanes: ['2402'], withdrawn: ['2401', '2400'] }
		const state = context && backlog_drive_cli.seeded_state(seeded, context)

		expect(state?.exclude).toStrictEqual(['2400', '2401'])
		expect(state?.in_flight).toStrictEqual(['2402'])
	})
})

describe('backlog_drive_cli.merge_token', () => {
	it('keeps a successful first line and a failed hand-back token', () => {
		expect(backlog_drive_cli.merge_token('2600\n', 0)).toBe('2600')
		expect(backlog_drive_cli.merge_token('retry\n', 1)).toBe('retry')
	})

	it('reads a crashed run:merge as no token rather than a collection', () => {
		const out = '[ELIFECYCLE] Command failed with exit code 1.'

		expect(backlog_drive_cli.merge_token(out, 1)).toBe('')
	})
})

it('accepts only mode without entering the backlog loop', () => {
	expect(backlog_drive_cli.parse(['--owner', '4242', '--only'])?.is_only).toBe(true)
})

// joshuafolkken/kit#3643: a `backlogrun` samples its own machine load for exactly as long as the drive
// runs — nobody starts a sampler beside it, and none is left running after it.
describe('backlog_drive_cli.run — the load sampler', () => {
	it('starts the sampler with the drive and stops it when the drive ends', async () => {
		const stop = vi.fn()
		const start = vi.spyOn(lane_sampler, 'start').mockReturnValue(stop)

		// No carry record: the drive ends at once, which is an end like any other.
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)

		await backlog_drive_cli.run(['--owner', '4242'])

		expect(start).toHaveBeenCalledOnce()
		expect(stop).toHaveBeenCalledOnce()
	})

	it('stops the sampler when the drive throws', async () => {
		const stop = vi.fn()

		vi.spyOn(lane_sampler, 'start').mockReturnValue(stop)
		vi.spyOn(run_carry, 'repository_directory').mockRejectedValue(new Error('git died'))
		vi.spyOn(console, 'info').mockImplementation(vi.fn())

		await backlog_drive_cli.run(['--owner', '4242'])

		expect(stop).toHaveBeenCalledOnce()
	})

	it('starts no sampler for arguments it refuses', async () => {
		const start = vi.spyOn(lane_sampler, 'start')

		vi.spyOn(console, 'error').mockImplementation(vi.fn())
		await backlog_drive_cli.run(['--owner'])

		expect(start).not.toHaveBeenCalled()
	})
})

it('reports before ending the carry record', async () => {
	const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: 'report' })
	const error = vi.spyOn(console, 'error').mockImplementation(vi.fn())

	await backlog_drive_cli.finish({
		reason: 'stop',
		token: 'stop',
		issue: undefined,
		is_finish: true,
	})

	expect(run.mock.calls.map(([argv]) => argv)).toStrictEqual([
		['run:report'],
		['run:carry', '--end'],
	])
	run.mockRestore()
	error.mockRestore()
})

it('keeps the window bound in the resume command', () => {
	const context = backlog_drive_cli.parse(['--owner', '4242', '--window', '9'])
	const state = backlog_drive.initial_state([], ACTIVE)

	expect(context && backlog_drive_cli.resume_line(state, context)).toContain('--window 9')
})
