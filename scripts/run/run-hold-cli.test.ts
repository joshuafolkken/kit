import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const git_directories = vi.mocked(git_command.git_directories)
const git_status = vi.mocked(git_command.status)
const CLEAN_TREE = ''
const DIRTY_TREE = ' M scripts/run/run-hold.ts'

const TEST_PREFIX = 'run-hold-cli-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const WORKTREE = path.join(scratch, '.git')
const OTHER_WORKTREE = path.join(scratch, '.git', 'worktrees', 'second')
const COMMON = path.join(scratch, '.git')
const ISSUE = '1091'
const OTHER_ISSUE = '1090'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const out: Array<string> = []
const errors: Array<string> = []

function reset_output(): void {
	out.length = 0
	errors.length = 0
}

beforeEach(() => {
	reset_output()
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
	git_directories.mockResolvedValue([WORKTREE, COMMON])
	git_status.mockResolvedValue(CLEAN_TREE)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(run_hold.hold_path(WORKTREE), { force: true })
	rmSync(run_hold.hold_path(OTHER_WORKTREE), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('parse_request', () => {
	it.each([
		[[], 'claim'],
		[[ISSUE], 'claim'],
		[['--release'], 'release'],
	])('reads %j as %s', (argv, kind) => {
		expect(run_hold_cli.parse_request(argv)?.kind).toBe(kind)
	})

	it.each([[['not-a-number']], [['--release', ISSUE]], [[ISSUE, '12']], [['0']]])(
		'refuses %j',
		(argv) => {
			expect(run_hold_cli.parse_request(argv)).toBeUndefined()
		},
	)
})

describe('claiming a free work tree', () => {
	it('answers hold and exits zero', async () => {
		expect(await run_hold_cli.run([ISSUE])).toBe(SUCCESS_EXIT_CODE)
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})

	it('records the issue number it was given', async () => {
		await run_hold_cli.run([ISSUE])

		const read = run_hold.read_hold(run_hold.hold_path(WORKTREE))

		expect(read.kind === 'held' ? read.hold.issue : undefined).toBe(ISSUE)
	})

	it('records an unnumbered run when the issue does not exist yet', async () => {
		await run_hold_cli.run([])

		const read = run_hold.read_hold(run_hold.hold_path(WORKTREE))

		expect(read.kind === 'held' ? read.hold.issue : undefined).toBe(run_hold.UNNUMBERED_ISSUE)
	})
})

describe('claiming a work tree another run holds', () => {
	beforeEach(async () => {
		await run_hold_cli.run([ISSUE])
		reset_output()
	})

	it('answers busy', async () => {
		await run_hold_cli.run([OTHER_ISSUE])

		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
	})

	it('names the holder and the time on standard error', async () => {
		await run_hold_cli.run([OTHER_ISSUE])

		expect(errors.join('\n')).toContain(`#${ISSUE}`)
		expect(errors.join('\n')).toContain(run_hold.RELEASE_COMMAND)
	})

	it('leaves the existing record in place', async () => {
		await run_hold_cli.run([OTHER_ISSUE])

		const read = run_hold.read_hold(run_hold.hold_path(WORKTREE))

		expect(read.kind === 'held' ? read.hold.issue : undefined).toBe(ISSUE)
	})

	it('does not stop a run in a different work tree of the same repository', async () => {
		git_directories.mockResolvedValue([OTHER_WORKTREE, COMMON])

		expect(await run_hold_cli.run([OTHER_ISSUE])).toBe(SUCCESS_EXIT_CODE)
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})
})

describe('releasing', () => {
	it('frees the tree for the next run', async () => {
		await run_hold_cli.run([ISSUE])
		await run_hold_cli.run(['--release'])
		reset_output()

		await run_hold_cli.run([OTHER_ISSUE])

		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})

	it('answers none when nothing held it', async () => {
		await run_hold_cli.run(['--release'])

		expect(out).toEqual([run_hold_cli.NONE_VERDICT])
	})
})

// A record can expire while the work it was guarding is still sitting in the tree — `halfrun`'s stop
// before commit is exactly that — so the age alone never decides.
describe('an expired record', () => {
	const EXPIRED_AT = new Date(Date.now() - (run_hold.HOLD_MAX_AGE_HOURS + 1) * 3_600_000)

	beforeEach(() => {
		run_hold.write_hold(run_hold.hold_path(WORKTREE), ISSUE, EXPIRED_AT)
		reset_output()
	})

	it('is replaced when the tree it guarded is clean', async () => {
		await run_hold_cli.run([OTHER_ISSUE])

		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})

	it('still stops the claim while the tree has uncommitted work', async () => {
		git_status.mockResolvedValue(DIRTY_TREE)

		await run_hold_cli.run([OTHER_ISSUE])

		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
		expect(errors.join('\n')).toContain('uncommitted changes')
	})

	it('stops the claim when the tree state could not be read', async () => {
		git_status.mockRejectedValue(new Error('git is not on the path'))

		await run_hold_cli.run([OTHER_ISSUE])

		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
	})
})

// Two sessions typing an entry point in the same second both read a free tree. The exclusive create
// is what makes exactly one of them win, and the loser must be told so rather than told it won.
describe('two claims racing for one tree', () => {
	it('answers busy to the claim that lost the exclusive create', async () => {
		vi.spyOn(run_hold, 'create_hold').mockReturnValue(false)

		await run_hold_cli.run([ISSUE])

		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
	})
})

describe('a failure nobody planned for', () => {
	it('still prints a token rather than leaving standard output empty', async () => {
		vi.spyOn(run_hold, 'read_hold').mockImplementation(() => {
			throw new Error('EACCES')
		})

		expect(await run_hold_cli.run([ISSUE])).toBe(FAILURE_EXIT_CODE)
		expect(out).toEqual([run_hold_cli.UNKNOWN_VERDICT])
	})
})

describe('a tree whose git directory cannot be read', () => {
	it('answers unknown and exits non-zero rather than letting the run through', async () => {
		git_directories.mockRejectedValue(new Error('not a git repository'))

		expect(await run_hold_cli.run([ISSUE])).toBe(FAILURE_EXIT_CODE)
		expect(out).toEqual([run_hold_cli.UNKNOWN_VERDICT])
	})
})

describe('a call it cannot parse', () => {
	it('prints the usage and exits non-zero', async () => {
		expect(await run_hold_cli.run(['nonsense'])).toBe(FAILURE_EXIT_CODE)
		expect(errors).toEqual([run_hold_cli.USAGE])
	})
})
