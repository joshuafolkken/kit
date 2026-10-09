import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_carry } from '#scripts/run/carry/run-carry'
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

const OPEN_PORTS: AddPorts = {
	read_issue: async () => ({ is_open: true, blockers: [] }),
	apply_label: async () => true,
}

function target(): string {
	return run_carry.carry_path(GIT_DIRECTORY)
}

beforeEach(() => {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(GIT_DIRECTORY)
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
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
