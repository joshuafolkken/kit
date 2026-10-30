import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { lane_spent } from '#scripts/lane/lane-spent'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddPorts } from './run-add'
import { run_add_cli } from './run-add-cli'

// joshuafolkken/kit#3433: `run:add` refuses a malformed request and a repository with no run, and
// writes a queued issue into a live named run's record.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-add-cli-test-'))
const GIT_DIRECTORY = path.join(scratch, 'repository.git')
const ADDED_ISSUE = 3433
const USAGE_EXIT_CODE = 2
const RETRY_INVOCATION = 'backlogrun #5413 --only'
const RETRY_ARGS = ['5413', '--retry']
const DISK_ERROR = 'disk unavailable'
const MISSING_CARRY = 'missing fixture carry'
const TERMINAL_REFUSAL = 'refused #5413 · not a mechanical stop'
const MISSING_TARGET = 'missing target'

const OPEN_PORTS: AddPorts = {
	read_issue: async () => ({ is_open: true, blockers: [] }),
	apply_label: async () => true,
	clear_label: async () => true,
}

function target(): string {
	return run_carry.carry_path(GIT_DIRECTORY)
}

function completed_retry(): void {
	const carry = run_carry.begin_carry(target(), RETRY_INVOCATION, run_carry.NO_OWNER, new Date())

	if (carry === undefined) throw new Error(MISSING_CARRY)
	run_carry.apply_change(target(), carry, { done: 5413 })
}

beforeEach(() => {
	vi.spyOn(lane_spent, 'lanes_in_use').mockResolvedValue({ working: [], unread: [] })
	vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([])
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(GIT_DIRECTORY)
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue(
		run_event_stream.target_of(GIT_DIRECTORY),
	)
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	run_carry.end_carry(target())
})

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('parse_request', () => {
	it('reads issues typed as N or #N, prioritized by default', () => {
		expect(run_add_cli.parse_request(['3433', '#3434'])).toStrictEqual({
			issues: [3433, 3434],
			is_priority: true,
			is_retry: false,
		})
	})

	it('appends with --no-priority', () => {
		expect(run_add_cli.parse_request(['3433', '--no-priority'])?.is_priority).toBe(false)
	})

	it('refuses a request with no issue or with a token that is not one', () => {
		expect(run_add_cli.parse_request([])).toBeUndefined()
		expect(run_add_cli.parse_request(['3433', 'abc'])).toBeUndefined()
	})
})

describe('run', () => {
	it('prints the usage on a malformed request', async () => {
		expect(await run_add_cli.run(['abc'], OPEN_PORTS)).toBe(USAGE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(run_add_cli.USAGE)
	})

	it('adds nothing when no backlogrun is running here', async () => {
		const apply_label = vi.fn(OPEN_PORTS.apply_label)

		expect(await run_add_cli.run([String(ADDED_ISSUE)], { ...OPEN_PORTS, apply_label })).toBe(1)
		expect(console.error).toHaveBeenCalledWith(run_add_cli.NO_RUN_MESSAGE)
		expect(apply_label).not.toHaveBeenCalled()
	})
})

describe('retry against a disappearing record', () => {
	it('does not report queued when the carry disappears during label updates', async () => {
		run_carry.begin_carry(target(), RETRY_INVOCATION, run_carry.NO_OWNER, new Date())
		const ports = {
			...OPEN_PORTS,
			clear_label: async () => {
				run_carry.end_carry(target())

				return true
			},
		}

		await expect(run_add_cli.run(RETRY_ARGS, ports)).rejects.toThrow('record disappeared')
		expect(console.info).not.toHaveBeenCalled()
	})
})

describe('non-mechanical retry protection', () => {
	it.each(['withdraw', 'merge', 'human-review', 'split'])(
		'refuses a previous %s rather than queueing an excluded issue',
		async (kind) => {
			run_carry.begin_carry(target(), RETRY_INVOCATION, run_carry.NO_OWNER, new Date())
			vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([
				{ pos: 1, kind, text: '#5413 settled', at: new Date().toISOString() },
			])
			const clear_label = vi.fn(OPEN_PORTS.clear_label)

			expect(await run_add_cli.run(RETRY_ARGS, { ...OPEN_PORTS, clear_label })).toBe(1)
			expect(clear_label).not.toHaveBeenCalled()
			expect(console.info).toHaveBeenCalledWith(TERMINAL_REFUSAL)
		},
	)

	it('protects a counted merge even after its event leaves the stream', async () => {
		const carry = run_carry.begin_carry(target(), RETRY_INVOCATION, run_carry.NO_OWNER, new Date())

		if (carry === undefined) throw new Error(MISSING_CARRY)
		run_carry.apply_change(target(), carry, { merged_issue: 5413 })

		expect(await run_add_cli.run(RETRY_ARGS, OPEN_PORTS)).toBe(1)
		expect(console.info).toHaveBeenCalledWith(TERMINAL_REFUSAL)
	})
})

describe('retry boundary write failures', () => {
	it.each([MISSING_TARGET, 'not appended'])('refuses %s without clearing done', async (failure) => {
		completed_retry()
		const append = vi.spyOn(run_event_stream_emit, 'append_at')

		if (failure === MISSING_TARGET) {
			vi.mocked(run_event_stream_emit.stream_target).mockResolvedValue(undefined)
		} else append.mockResolvedValue({ appended: false, position: 0 })

		await expect(run_add_cli.run(RETRY_ARGS, OPEN_PORTS)).rejects.toThrow(
			'Could not record the retry boundary.',
		)
		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? read.carry.done : []).toStrictEqual([5413])
		expect(console.info).not.toHaveBeenCalled()
		if (failure === MISSING_TARGET) expect(append).not.toHaveBeenCalled()
	})
})

describe('GitHub retry labels', () => {
	it.each([
		{ label: 'needs-decision', exit: 1 },
		{ label: 'run:stalled', exit: 0 },
	])('honors $label through the default ports', async ({ label, exit }) => {
		run_carry.begin_carry(target(), RETRY_INVOCATION, run_carry.NO_OWNER, new Date())
		vi.spyOn(git_gh_command, 'issue_get_state_and_relations_classified').mockResolvedValue({
			kind: 'read',
			json: JSON.stringify({ number: 5413, state: 'OPEN', labels: [{ name: label }] }),
		})
		vi.spyOn(git_gh_command, 'issue_add_label').mockResolvedValue(true)
		const clear = vi.spyOn(git_gh_command, 'issue_clear_label').mockResolvedValue(true)

		expect(await run_add_cli.run(RETRY_ARGS)).toBe(exit)
		expect(clear).toHaveBeenCalledTimes(exit === 0 ? 1 : 0)
	})
})

describe('retry in a pool run', () => {
	it('clears done without converting the pool into a named queue', async () => {
		const carry = run_carry.begin_carry(target(), 'backlogrun', run_carry.NO_OWNER, new Date())

		if (carry === undefined) throw new Error(MISSING_CARRY)
		run_carry.apply_change(target(), carry, { done: 5413 })

		expect(await run_add_cli.run(RETRY_ARGS, OPEN_PORTS)).toBe(0)
		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? read.carry.done : undefined).toStrictEqual([])
		expect(read.kind === 'carried' ? read.carry.added : []).toBeUndefined()
	})
})

describe('retry against a live record', () => {
	it('clears the retried completion and persists the boundary a new driver reads', async () => {
		const carry = run_carry.begin_carry(
			target(),
			'backlogrun #5413 #5400 --only',
			run_carry.NO_OWNER,
			new Date(),
		)

		if (carry === undefined) throw new Error(MISSING_CARRY)
		run_carry.apply_change(target(), carry, { done: 5413 })
		const stream = run_event_stream.target_of(GIT_DIRECTORY)

		run_event_stream.append(stream, 'park', '#5413 parked (run:stalled)', new Date().toISOString())
		expect(await run_add_cli.run(RETRY_ARGS, OPEN_PORTS)).toBe(0)
		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? run_carry.remaining_of(read.carry) : []).toStrictEqual([
			5413, 5400,
		])
		expect(
			backlog_drive_restore.settled_issues(run_event_stream.read_events(stream)).has(5413),
		).toBe(false)
	})

	it('keeps done and emits no queued message if the retry boundary cannot be written', async () => {
		const carry = run_carry.begin_carry(target(), RETRY_INVOCATION, run_carry.NO_OWNER, new Date())

		if (carry === undefined) throw new Error(MISSING_CARRY)
		run_carry.apply_change(target(), carry, { done: 5413 })
		vi.spyOn(run_event_stream_emit, 'append_at').mockRejectedValue(new Error(DISK_ERROR))

		await expect(run_add_cli.run(RETRY_ARGS, OPEN_PORTS)).rejects.toThrow(DISK_ERROR)
		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? read.carry.done : []).toStrictEqual([5413])
		expect(console.info).not.toHaveBeenCalled()
	})
})

describe('live lane protection', () => {
	it.each(['working', 'unread'] as const)(
		'refuses %s lanes found outside the current event stream',
		async (kind) => {
			run_carry.begin_carry(target(), RETRY_INVOCATION, run_carry.NO_OWNER, new Date())
			vi.mocked(lane_spent.lanes_in_use).mockResolvedValue({
				working: [],
				unread: [],
				[kind]: ['5413'],
			})

			expect(await run_add_cli.run(RETRY_ARGS, OPEN_PORTS)).toBe(1)
			expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
			expect(console.info).toHaveBeenCalledWith('refused #5413 · active lane')
		},
	)
})

describe('run against a live record', () => {
	it('writes a queued issue into a live --only run and announces it', async () => {
		run_carry.begin_carry(target(), 'backlogrun #1762 --only', run_carry.NO_OWNER, new Date())

		expect(await run_add_cli.run([String(ADDED_ISSUE)], OPEN_PORTS)).toBe(0)

		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? run_carry.remaining_of(read.carry) : []).toStrictEqual([
			ADDED_ISSUE,
			1762,
		])
		expect(run_event_stream_emit.emit).toHaveBeenCalledWith('add', `added #${String(ADDED_ISSUE)}`)
	})

	it('writes a queued issue into a named run without --only, ahead of its named list', async () => {
		run_carry.begin_carry(target(), 'backlogrun #1762 #1763', run_carry.NO_OWNER, new Date())

		expect(await run_add_cli.run([String(ADDED_ISSUE)], OPEN_PORTS)).toBe(0)

		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? run_carry.remaining_of(read.carry) : []).toStrictEqual([
			ADDED_ISSUE,
			1762,
			1763,
		])
	})

	it('leaves a pool run record alone, since the labels are what it reads', async () => {
		run_carry.begin_carry(target(), 'backlogrun', run_carry.NO_OWNER, new Date())

		expect(await run_add_cli.run([String(ADDED_ISSUE)], OPEN_PORTS)).toBe(0)

		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? read.carry.added : []).toBeUndefined()
	})
})
