import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'

// joshuafolkken/kit#2760: a `backlogrun` parent that had taken its cut at 233k retyped the keyword in
// the same conversation and was answered `resumed` by its own hand-off, at 232k and again at 258k. A
// session over the shared context-cut threshold now claims nothing. Colocated apart from
// `run-carry-cli.test.ts`, which is at its line ceiling.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-cli-over-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const FAILURE_EXIT_CODE = 1
const OVER: CostVerdict = 'over'
const UNDER: CostVerdict = 'under'
const UNMEASURABLE: CostVerdict = 'unmeasurable'

const out: Array<string> = []
const session_verdict = vi.spyOn(cost_cli, 'session_verdict')

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

beforeEach(() => {
	out.length = 0
	vi.spyOn(console, 'info').mockImplementation((text: string) => {
		out.push(text)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	session_verdict.mockReturnValue(UNDER)
	run_carry.end_carry(target())
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(scratch, { force: true, recursive: true })
})

describe('a session over the context-cut threshold claims nothing', () => {
	it('refuses --begin with over and writes no record', async () => {
		session_verdict.mockReturnValue(OVER)

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(FAILURE_EXIT_CODE)
		expect(out).toStrictEqual([run_carry_cli.OVER_VERDICT])
		expect(run_carry.read_carry(target()).kind).toBe('none')
	})

	// The measured defect: the session that took the cut re-begins and is handed its own record back.
	it('refuses the self-resume of a record this session handed off, leaving it handed off', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--cut'])
		const handed_off = run_carry.read_carry(target())

		session_verdict.mockReturnValue(OVER)
		out.length = 0

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(FAILURE_EXIT_CODE)
		expect(out).toStrictEqual([run_carry_cli.OVER_VERDICT])
		expect(run_carry.read_carry(target())).toStrictEqual(handed_off)
	})

	it('refuses --resume the same way', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		session_verdict.mockReturnValue(OVER)
		out.length = 0

		expect(await run_carry_cli.run(['--resume', INVOCATION])).toBe(FAILURE_EXIT_CODE)
		expect(out).toStrictEqual([run_carry_cli.OVER_VERDICT])
	})

	// A fresh successor is under; a provider with no transcript cannot be priced, so it is not refused.
	it.each([[UNDER], [UNMEASURABLE]])('resumes a handed-off record when %j', async (verdict) => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--cut'])
		session_verdict.mockReturnValue(verdict)
		out.length = 0

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.RESUMED_VERDICT])
	})
})
