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
const SNAPSHOT = 'snapshot'
const CHECK_STARTED = 'check started'
const CHECK_DONE = 'check done'
const GREEN_RUN = { result: GREEN, fix_exit_code: 0, settled: SNAPSHOT }

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

function hooks(
	check: () => Promise<string>,
	settled: () => Promise<string> = async () => await SNAPSHOT,
): {
	check: () => Promise<string>
	time: (fix: () => Promise<number>) => Promise<number>
	settled: () => Promise<string>
} {
	return { check, time: async (fix) => await fix(), settled }
}

async function next_event_loop_turn(): Promise<void> {
	await new Promise<void>((resolve) => {
		setImmediate(resolve)
	})
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

		expect(await lint_related_fix.beside(scope, directory, hooks(check))).toEqual(GREEN_RUN)
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
			settled: SNAPSHOT,
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
			settled: SNAPSHOT,
		})
		expect(check).toHaveBeenCalledTimes(2)
	})
})

describe('lint_related_fix.beside snapshot', () => {
	it('takes the verification snapshot once the fix pass ends, before the checks finish', async () => {
		const { directory, scope } = fixture()
		const order: Array<string> = []
		const finish = held_fix(order)
		const check = vi.fn(async () => {
			order.push(CHECK_STARTED)
			finish()
			await next_event_loop_turn()
			order.push(CHECK_DONE)

			return GREEN
		})
		const settled = vi.fn(async () => {
			order.push('settled')

			return await SNAPSHOT
		})

		await lint_related_fix.beside(scope, directory, hooks(check, settled))
		expect(order).toEqual([FIX_STARTED, CHECK_STARTED, 'settled', CHECK_DONE])
	})
})
