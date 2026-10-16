import { core_budget } from '#scripts/gate/core-budget'
import {
	CSPELL_CACHE_FLAGS,
	CSPELL_COMMIT_CACHE_FLAGS,
	ESLINT_CACHE_FLAGS,
	ESLINT_COMMIT_CACHE_FLAGS,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))

const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)
const { pre_commit_lint } = await import('./pre-commit-lint')

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

const STAGED = ['src/a.ts', 'docs/b.md']

function built(tool: string): ReadonlyArray<string> {
	return pre_commit_lint.build_arguments(tool, STAGED) ?? []
}

function joined(tool: string): string {
	return built(tool).join(' ')
}

beforeEach(() => {
	vi.clearAllMocks()
})

// joshuafolkken/kit#3948: the pre-commit hook's cache locations come from the same constants the
// ignore rules are asserted against, joined so a flag stays paired with its value. The gate's location
// is excluded by comparing the argument itself: `.cspellcache.commit` has `.cspellcache` as a prefix,
// so a substring check of the joined line could never pass.
describe('pre_commit_lint.build_arguments', () => {
	it('spell-checks the staged files through the hook cache, not the gate cache it would prune', () => {
		expect(joined('cspell')).toContain(CSPELL_COMMIT_CACHE_FLAGS.join(' '))
		expect(built('cspell')).not.toContain(CSPELL_CACHE_FLAGS.at(-1))
	})

	it('checks formatting through the prettier cache the gate warms', () => {
		expect(joined('prettier')).toContain(`--ignore-unknown ${PRETTIER_CACHE_FLAGS.join(' ')}`)
	})

	it('lints quietly through the hook cache, so warning-less reports never reach the gate', () => {
		expect(joined('eslint')).toContain(`--quiet ${ESLINT_COMMIT_CACHE_FLAGS.join(' ')}`)
		expect(built('eslint')).not.toContain(ESLINT_CACHE_FLAGS.at(-1))
	})

	it('passes the staged files last', () => {
		expect(pre_commit_lint.build_arguments('eslint', STAGED)?.slice(-STAGED.length)).toEqual(STAGED)
	})

	it('answers nothing for a tool it does not know', () => {
		expect(pre_commit_lint.build_arguments('stylelint', STAGED)).toBeUndefined()
	})
})

describe('pre_commit_lint.run', () => {
	it('returns the tool exit code', async () => {
		mocked_execa.mockResolvedValueOnce({ exitCode: 1 } as unknown as ExecaResult)

		expect(await pre_commit_lint.run(['prettier', ...STAGED])).toBe(1)
		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			pre_commit_lint.build_arguments('prettier', STAGED),
			expect.objectContaining({ stdio: 'inherit' }),
		)
	})

	// joshuafolkken/kit#3944: lefthook starts the three tools in parallel, each off the ledger until now.
	it.each([
		['cspell', 'spell_check'],
		['prettier', 'format'],
		['eslint', 'eslint_scan'],
	] as const)('claims the core budget %s is declared under', async (tool, budget) => {
		const reservation = vi.spyOn(core_budget, 'with_command_reservation').mockResolvedValue(0)

		expect(await pre_commit_lint.run([tool, ...STAGED])).toBe(0)
		expect(reservation).toHaveBeenCalledWith(
			core_budget.CORE_WEIGHTS[budget],
			expect.any(Function),
			expect.objectContaining({ memory_mb: core_budget.MEMORY_MB[budget] }),
		)
		reservation.mockRestore()
	})

	it('refuses an unknown tool with a usage error and runs nothing', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await pre_commit_lint.run(['stylelint'])).toBe(pre_commit_lint.USAGE_ERROR_EXIT_CODE)
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})
