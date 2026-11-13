import { scoped_green } from '#scripts/gate/scoped-green'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { format_steps } from './format-steps'
import { lint_related_fix } from './lint-related-fix'

vi.mock('./format-steps', () => ({ format_steps: { run_scoped: vi.fn() } }))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { read_before: vi.fn() } }))

afterEach(() => vi.restoreAllMocks())

describe('lint_related_fix.prepare', () => {
	it('takes the verification snapshot after scoped writers finish, even on residual red', async () => {
		const scope = { mode: 'related', files: ['source.ts'], reason: 'explicit' } as const
		const after = { files: { 'source.ts': 'fixed' }, base: 'base' }

		vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		vi.mocked(format_steps.run_scoped).mockResolvedValue(1)
		vi.mocked(scoped_green.read_before).mockResolvedValue(after)
		expect(await lint_related_fix.prepare([], scope, '/project')).toEqual(after)
		expect(format_steps.run_scoped).toHaveBeenCalledWith(scope, '/project')
		expect(vi.mocked(format_steps.run_scoped).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(scoped_green.read_before).mock.invocationCallOrder[0] ?? 0,
		)
	})
})
