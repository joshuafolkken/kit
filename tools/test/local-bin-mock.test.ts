import { describe, expect, it } from 'vitest'
import { direct_launch, resolve_package_bin } from './local-bin-mock'

const PNPM_EXEC = ['exec', 'eslint', '--quiet', 'src/a.ts']

describe('local-bin-mock', () => {
	it('holds direct_launch at the pnpm fallback with the list unchanged', () => {
		expect(direct_launch('/repo', PNPM_EXEC)).toEqual({ file: 'pnpm', args: PNPM_EXEC })
	})

	it('leaves resolve_package_bin unanswered until a test answers it', () => {
		expect(resolve_package_bin('/repo', 'eslint_d', 'eslint_d')).toBeUndefined()
	})
})
