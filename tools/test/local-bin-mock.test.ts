import { describe, expect, it } from 'vitest'
import { direct_launch, DIRECT_LAUNCH_FILE, resolve_package_bin } from './local-bin-mock'

const PNPM_EXEC = ['exec', 'eslint', '--quiet', 'src/a.ts']

describe('local-bin-mock', () => {
	it('keeps the list unchanged under a file other than pnpm', () => {
		expect(direct_launch('/repo', PNPM_EXEC)).toEqual({ file: DIRECT_LAUNCH_FILE, args: PNPM_EXEC })
		expect(DIRECT_LAUNCH_FILE).not.toBe('pnpm')
	})

	it('leaves resolve_package_bin unanswered until a test answers it', () => {
		expect(resolve_package_bin('/repo', 'eslint_d', 'eslint_d')).toBeUndefined()
	})
})
