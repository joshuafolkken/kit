import { describe, expect, it, vi } from 'vitest'
import { hook_lap } from './hook-lap'

// joshuafolkken/kit#5831: each git hook josh dispatches is timed under the name `lane:breakdown` prints.

const HOOK_CATEGORY = 'Git hooks'
const SCOPE_KEY = 'JOSH_SHIP_LAP_SCOPE'
const LINT_COMMAND = 'pre-commit-lint'
const RESERVED_COMMAND = 'reserved-run'
const UNIT_HOOK = 'pre-push-unit'
const TYPE_HOOK = 'pre-commit-type-check'

describe('hook_lap.step_of — the name a hook lap is written under', () => {
	it.each([
		[LINT_COMMAND, ['eslint', '--', 'a.ts'], 'eslint'],
		[LINT_COMMAND, ['cspell'], 'cspell'],
		[LINT_COMMAND, ['prettier'], 'prettier'],
		[RESERVED_COMMAND, ['--cores', '2', '--', 'pnpm', 'install'], 'pnpm install'],
		[RESERVED_COMMAND, ['--', 'pnpm', 'josh', 'audit'], 'audit'],
		[UNIT_HOOK, [], UNIT_HOOK],
		[TYPE_HOOK, [], TYPE_HOOK],
	])('%s %j → %s', (command, args, step) => {
		expect(hook_lap.step_of(command, args)).toBe(step)
	})

	it('names a linter-less pre-commit-lint by its own command', () => {
		expect(hook_lap.step_of(LINT_COMMAND, [])).toBe(LINT_COMMAND)
	})
})

describe('hook_lap.timed_command — which commands are timed', () => {
	it('runs a command outside the git hooks as it is', async () => {
		const run = vi.fn(async () => 0)

		await expect(hook_lap.timed_command('gate', 'Verification', [], run)).resolves.toBe(0)
		expect(run).toHaveBeenCalledOnce()
	})

	it('runs a git hook through its lap and passes its exit code through', async () => {
		const run = vi.fn(async () => 1)

		await expect(hook_lap.timed_command(UNIT_HOOK, HOOK_CATEGORY, [], run)).resolves.toBe(1)
		expect(run).toHaveBeenCalledOnce()
	})

	it('hands no lap scope down to the processes a git hook starts', async () => {
		const scope = JSON.stringify({ issue: 0, stage: 'ship commit', parent: 'josh git' })
		const seen: Array<string | undefined> = []

		vi.stubEnv(SCOPE_KEY, scope)
		await hook_lap.timed_command(UNIT_HOOK, HOOK_CATEGORY, [], async () => {
			seen.push(process.env[SCOPE_KEY])

			return 0
		})
		vi.unstubAllEnvs()

		expect(seen).toEqual([''])
	})

	// joshuafolkken/kit#5896: a hook's process starts inside the `josh git` step that ran git.
	it('times a git hook with no startup lap of its own', async () => {
		const { run_ship_lap } = await import('#scripts/run/ship/run-ship-lap')
		const timed = vi.spyOn(run_ship_lap, 'timed')

		await hook_lap.timed_command(UNIT_HOOK, HOOK_CATEGORY, [], async () => 0)

		expect(timed).toHaveBeenCalledWith(UNIT_HOOK, expect.any(Function), { startup: false })
		timed.mockRestore()
	})
})
