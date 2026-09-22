import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'

// joshuafolkken/kit#2346: `run:carry --cut` past the cap is refused with `capped` and the run carries on
// uncut, so a run that has begun to churn cannot keep paying a cold preamble the accumulation it sheds
// no longer covers. Colocated apart from `run-carry-cli.test.ts` to keep that file under its line
// ceiling — this pins the CLI verdict, `run-carry.test.ts` pins the `is_at_cut_cap` read it rests on.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-cli-cap-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'

const out: Array<string> = []

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
	run_carry.end_carry(target())
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(scratch, { force: true, recursive: true })
})

describe('the cut count has a ceiling', () => {
	it('refuses a cut past the cap and carries the run on uncut', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		const read = run_carry.read_carry(target())

		if (read.kind !== 'carried') throw new Error('expected a carried record')

		// Seed the count at the cap on disk, then clear the hand-off a cut sets so the count is read for
		// the cap rather than first refused as handed off.
		const at_cap = run_carry.apply_change(target(), read.carry, { cuts: run_carry.MAX_CUTS })

		run_carry.apply_change(target(), at_cap, { merged: 0 })
		out.length = 0

		expect(await run_carry_cli.run(['--cut'])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.CAPPED_VERDICT])
	})
})
