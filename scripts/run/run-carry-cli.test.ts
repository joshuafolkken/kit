import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'

// joshuafolkken/kit#1714. Two things are pinned here that prose alone would let a rewrite lose:
// standard output is one token on every path, and `--begin` over a live record answers `resumed`
// rather than starting a second budget over the first one's.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const TEST_PREFIX = 'run-carry-cli-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const OTHER_INVOCATION = 'backlogrun --max 10 --idle 30'
const LONG_AGO = new Date(Date.now() - run_carry.CARRY_MAX_AGE_MS * 2)

const out: Array<string> = []
const errors: Array<string> = []

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

beforeEach(() => {
	out.length = 0
	errors.length = 0
	vi.spyOn(console, 'info').mockImplementation((text: string) => {
		out.push(text)
	})
	vi.spyOn(console, 'error').mockImplementation((text: string) => {
		errors.push(text)
	})
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	run_carry.end_carry(target())
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(target(), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('the record is keyed to the repository rather than the work tree', () => {
	it('reads none before anything has begun', async () => {
		expect(await run_carry_cli.run([])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.NONE_VERDICT])
	})
})

describe('beginning a run', () => {
	it('answers began the first time', async () => {
		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.BEGAN_VERDICT])
	})

	it('answers resumed over a live record and leaves its start time alone', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		const first = run_carry.read_carry(target())

		out.length = 0
		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)

		expect(out).toStrictEqual([run_carry_cli.RESUMED_VERDICT])
		expect(run_carry.read_carry(target())).toStrictEqual(first)
	})

	it('replaces a record whose whole-run bound is spent', async () => {
		run_carry.begin_carry(target(), INVOCATION, LONG_AGO)

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.BEGAN_VERDICT])
		expect(run_carry.read_carry(target()).kind).toBe('carried')
	})

	// `--end` is only reached on the clean-finish path, so a crashed run leaves its record standing.
	// Resuming into it would spend that run's `--max` and its hours, not this invocation's.
	it('refuses a live record belonging to a different invocation', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		out.length = 0

		expect(await run_carry_cli.run(['--begin', OTHER_INVOCATION])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.MISMATCH_VERDICT])
	})
})

describe('counting into a carried run', () => {
	it('accumulates a merge, a filing and a cut', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--merged', '1', '--filed', '2'])
		await run_carry_cli.run(['--cut'])

		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? read.carry : undefined).toMatchObject({
			merged: 1,
			filed: 2,
			cuts: 1,
		})
	})

	it('refuses a count with no record to count into', async () => {
		expect(await run_carry_cli.run(['--merged', '1'])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.NONE_VERDICT])
	})

	// A wave that merged nothing still reports a count, and the record it counts into is either there
	// or it is not — reading the zero as a bare read would answer `none` with exit 0.
	it('treats a zero increment as a count, so a missing record still exits non-zero', async () => {
		expect(await run_carry_cli.run(['--merged', '0'])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.NONE_VERDICT])
	})

	it('answers expired once the bound is spent, without losing the count', async () => {
		run_carry.begin_carry(target(), INVOCATION, LONG_AGO)

		expect(await run_carry_cli.run(['--merged', '1'])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.EXPIRED_VERDICT])
	})
})

describe('reading the record back after a cut', () => {
	it('prints the whole record as one JSON line', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		out.length = 0

		await run_carry_cli.run(['--json'])

		expect(out).toHaveLength(1)
		expect(JSON.parse(out[0] ?? '')).toMatchObject({
			verdict: run_carry_cli.CARRIED_VERDICT,
			carry: { invocation: INVOCATION, merged: 0, cuts: 0 },
		})
	})
})

describe('ending a run', () => {
	it('clears the record and answers ended', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		out.length = 0

		expect(await run_carry_cli.run(['--end'])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.ENDED_VERDICT])
		expect(run_carry.read_carry(target()).kind).toBe('none')
	})
})

describe('an invocation the command cannot act on', () => {
	it.each([
		['two groups at once', ['--begin', INVOCATION, '--end']],
		['a count that is not a number', ['--merged', 'lots']],
		['an unknown flag', ['--nope']],
	])('refuses %s', async (_name, argv) => {
		expect(await run_carry_cli.run(argv)).toBe(1)
		expect(errors).toContain(run_carry_cli.USAGE)
	})

	it('answers unknown when the git directory cannot be read', async () => {
		git_directories.mockRejectedValue(new Error('no git'))

		expect(await run_carry_cli.run([])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.UNKNOWN_VERDICT])
	})
})
