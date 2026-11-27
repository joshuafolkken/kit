import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { format_steps } from './format-steps'
import { lint_related_fix } from './lint-related-fix'

vi.mock('./format-steps', () => ({ format_steps: { run_scoped: vi.fn() } }))

const create_directory = temporary_directory()
const GREEN = 'green'
const FIX_STARTED = 'fix started'

afterEach(() => vi.restoreAllMocks())

interface Fixture {
	directory: string
	source: string
	scope: { mode: 'related'; files: Array<string>; reason: 'explicit' }
}

function fixture(): Fixture {
	const directory = create_directory('lint-related-fix-')
	const source = path.join(directory, 'source.ts')

	writeFileSync(source, 'unfixed\n')
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	return { directory, source, scope: { mode: 'related', files: [source], reason: 'explicit' } }
}

function hooks(check: () => Promise<string>): {
	check: () => Promise<string>
	time: (fix: () => Promise<number>) => Promise<number>
} {
	return { check, time: async (fix) => await fix() }
}

function held_fix(order: Array<string>): () => void {
	const release: Array<(code: number) => void> = []

	vi.mocked(format_steps.run_scoped).mockImplementation(
		async () =>
			await new Promise<number>((resolve) => {
				order.push(FIX_STARTED)
				release.push(resolve)
			}),
	)

	return function finish(): void {
		for (const resolve of release) resolve(0)
	}
}

describe('lint_related_fix.beside overlap', () => {
	it('starts the checks while the fix pass is still running (ac-81fe1ad7)', async () => {
		const { directory, scope } = fixture()
		const order: Array<string> = []
		const finish = held_fix(order)
		const check = vi.fn(async () => {
			order.push('check')
			finish()

			return GREEN
		})

		expect(await lint_related_fix.beside(scope, directory, hooks(check))).toEqual({
			result: GREEN,
			fix_exit_code: 0,
		})
		expect(order).toEqual([FIX_STARTED, 'check'])
	})

	it('finishes a whole-tree fix pass before the checks start', async () => {
		const { directory } = fixture()
		const order: Array<string> = []

		vi.mocked(format_steps.run_scoped).mockImplementation(async () => {
			order.push('fix done')

			return 0
		})
		const check = vi.fn(async () => {
			order.push('check')

			return GREEN
		})

		await lint_related_fix.beside(
			{ mode: 'all', files: [], reason: 'fallback' },
			directory,
			hooks(check),
		)
		expect(order).toEqual(['fix done', 'check'])
	})
})

describe('lint_related_fix.beside report', () => {
	it('reports the fix pass exit code unchanged and checks once (ac-81fe1ad7)', async () => {
		const { directory, scope } = fixture()
		const check = vi.fn(async () => GREEN)

		vi.mocked(format_steps.run_scoped).mockResolvedValue(1)

		expect(await lint_related_fix.beside(scope, directory, hooks(check))).toEqual({
			result: GREEN,
			fix_exit_code: 1,
		})
		expect(format_steps.run_scoped).toHaveBeenCalledWith(scope, directory)
		expect(check).toHaveBeenCalledOnce()
	})

	it('checks the fixed tree again when the fix pass rewrote a file (ac-81fe1ad7)', async () => {
		const { directory, source, scope } = fixture()
		const check = vi.fn<() => Promise<string>>()

		check.mockResolvedValueOnce('stale').mockResolvedValueOnce('fixed')
		vi.mocked(format_steps.run_scoped).mockImplementation(async () => {
			writeFileSync(source, 'fixed\n')

			return 0
		})

		expect(await lint_related_fix.beside(scope, directory, hooks(check))).toEqual({
			result: 'fixed',
			fix_exit_code: 0,
		})
		expect(check).toHaveBeenCalledTimes(2)
	})
})
