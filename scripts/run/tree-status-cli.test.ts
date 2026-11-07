import { readFileSync } from 'node:fs'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { josh_read_only } from '#scripts/josh/josh-read-only'
import type { RunHold } from '#scripts/run/hold/run-hold'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tree_status } from './tree-status'

const branch_mock = vi.hoisted(() => vi.fn())
const read_mock = vi.hoisted(() => vi.fn())
const stash_list_mock = vi.hoisted(() => vi.fn())
const worktree_directory_mock = vi.hoisted(() => vi.fn())
const hold_path_mock = vi.hoisted(() => vi.fn())
const read_hold_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())
const NOTES = vi.hoisted(() => ({ stale: 'stale record', unreadable: 'unreadable record' }))

// Only the readers are mocked: a write the CLI reached for would be `undefined` here and throw.
vi.mock('#scripts/git/git-command', () => ({ git_command: { branch: branch_mock } }))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: read_mock } }))
vi.mock('#scripts/git/stash/git-stash', () => ({ git_stash: { list: stash_list_mock } }))
vi.mock('#scripts/run/hold/run-hold', () => ({
	run_hold: {
		worktree_directory: worktree_directory_mock,
		hold_path: hold_path_mock,
		read_hold: read_hold_mock,
		describe_holder: (hold: RunHold): string => `holder ${hold.issue}`,
		stale_reason: (): string => NOTES.stale,
		unreadable_message: (): string => NOTES.unreadable,
		unknown_message: (): string => 'unknown directory',
	},
}))

const { tree_status_cli } = await import('./tree-status-cli')

const SUCCESS = 0
const FAILURE = 1
const BRANCH = '5852-lane'
const CLI_PATH = 'scripts/run/tree-status-cli.ts'
const STATUS = `## ${BRANCH}...origin/${BRANCH}\n M scripts/a.ts\n?? scripts/b.ts`
const HOLD: RunHold = { issue: '5852', taken_at: '2026-11-02T00:00:00Z', pid: 1 }
const STASH = { selector: 'stash@{0}', subject: 'On main: parked work' }

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function stub_ok(): void {
	branch_mock.mockResolvedValue(BRANCH)
	read_mock.mockResolvedValue(STATUS)
	stash_list_mock.mockResolvedValue([STASH])
	worktree_directory_mock.mockResolvedValue('/repo/.git/worktrees/5852')
	hold_path_mock.mockReturnValue('/repo/.git/worktrees/5852/hold')
	read_hold_mock.mockReturnValue({ kind: 'held', hold: HOLD })
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	stub_ok()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('tree_status_cli.run bundles the four reads', () => {
	it('leads with the one-line summary of branch, changes, stash and hold', async () => {
		expect(await tree_status_cli.run([])).toBe(SUCCESS)
		expect(printed()).toContain(
			`${tree_status.SUMMARY_PREFIX}branch: ${BRANCH} · changes: 2 · stash: 1 · hold: held`,
		)
	})

	it('prints the status, stash and hold sections', async () => {
		await tree_status_cli.run([])

		const out = printed()
		const expected = [
			tree_status.STATUS_HEADER,
			' M scripts/a.ts',
			tree_status.STASH_HEADER,
			`${STASH.selector} ${STASH.subject}`,
			tree_status.HOLD_HEADER,
			'holder 5852',
		]

		expect(expected.every((part) => out.includes(part))).toBe(true)
	})
})

describe('tree_status_cli.run reads the tree as it is', () => {
	it('reads the porcelain status with its branch line', async () => {
		await tree_status_cli.run([])

		expect(read_mock).toHaveBeenCalledWith(
			expect.arrayContaining(['status', '--porcelain', '--branch']),
		)
	})

	it('disables the optional index refresh before the status subcommand', async () => {
		await tree_status_cli.run([])

		const [arguments_] = read_mock.mock.calls[0] ?? []

		expect(arguments_?.slice(0, 2)).toEqual(['--no-optional-locks', 'status'])
	})

	it('reports a clean tree and an empty stash', async () => {
		read_mock.mockResolvedValue(`## ${BRANCH}`)
		stash_list_mock.mockResolvedValue([])

		await tree_status_cli.run([])

		expect(printed()).toContain('changes: 0 · stash: 0')
		expect(printed()).toContain(tree_status.NO_STASH_NOTE)
	})

	it('refuses an argument', async () => {
		expect(await tree_status_cli.run(['5852'])).toBe(FAILURE)
		expect(error_mock).toHaveBeenCalledWith(expect.stringContaining('Usage'))
	})
})

describe('tree_status_cli.run reports each hold state', () => {
	it.each([
		[{ kind: 'free' }, 'hold: free', SUCCESS],
		[{ kind: 'stale', hold: HOLD }, NOTES.stale, SUCCESS],
		[{ kind: 'unreadable' }, NOTES.unreadable, FAILURE],
	])('%o prints %s', async (read, text, code) => {
		read_hold_mock.mockReturnValue(read)

		expect(await tree_status_cli.run([])).toBe(code)
		expect(printed()).toContain(text)
	})

	it('reports a stale record as still recorded, never as replaced', async () => {
		read_hold_mock.mockReturnValue({ kind: 'stale', hold: HOLD })

		await tree_status_cli.run([])

		expect(printed()).toContain('Stale run record held by holder 5852: stale record.')
		expect(printed()).not.toContain('Replaced')
	})

	it('answers unknown, non-zero, when the git directory cannot be read', async () => {
		worktree_directory_mock.mockResolvedValue(undefined)

		expect(await tree_status_cli.run([])).toBe(FAILURE)
		expect(read_hold_mock).not.toHaveBeenCalled()
		expect(printed()).toContain('hold: unknown')
	})
})

// The command is the pre-check a session runs before acting on the tree, so it must never mutate what
// it reads: the hold is read, not claimed, and the stash is listed, not pushed or popped
// (joshuafolkken/kit#5852).
describe('tree:status is read-only', () => {
	const source = readFileSync(CLI_PATH, 'utf8')

	it.each([
		'write_hold',
		'create_hold',
		'create_stop_hold',
		'release_hold',
		'stale_message',
		'git_stash.push',
		'git_stash.pop',
		'drop_by_hash',
		"'add'",
		"'checkout'",
	])('does not reference the write %s', (token) => {
		expect(source).not.toContain(token)
	})
})

describe('josh tree:status registration', () => {
	it('is registered as a josh command', () => {
		expect(COMMAND_MAP['tree:status']?.script).toBe(CLI_PATH)
	})

	// A consultation scope runs only what passes the read-only check, and every rule asks for this
	// pre-check before a tree assumption (joshuafolkken/kit#6554).
	it('passes the read-only check a consultation scope applies (ac-9c5edfb6)', () => {
		expect(josh_read_only.refusal(['tree:status'])).toBeUndefined()
	})
})
