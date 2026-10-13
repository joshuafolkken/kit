import { describe, expect, it } from 'vitest'
import { pnpm_reach } from './pnpm-reach'

const NOT_FOUND_CODE = 'ENOENT'
const PERMISSION_CODE = 'EACCES'
const PREREQUISITES_ANCHOR = 'docs/setup/prerequisites.md#2-install-pnpm-and-nodejs'

describe('pnpm_reach.is_not_found', () => {
	it('is true when the spawn reported the executable missing from PATH', () => {
		expect(pnpm_reach.is_not_found({ code: NOT_FOUND_CODE })).toBe(true)
	})

	it('is false for another spawn failure', () => {
		expect(pnpm_reach.is_not_found({ code: PERMISSION_CODE })).toBe(false)
	})

	it('is false when the child started and carries no code', () => {
		expect(pnpm_reach.is_not_found({})).toBe(false)
	})
})

describe('pnpm_reach.NOT_ON_PATH_NOTICE', () => {
	it('names pnpm and the PATH as the reason the command could not start', () => {
		expect(pnpm_reach.NOT_ON_PATH_NOTICE).toContain(`${pnpm_reach.PNPM} was not found on the PATH`)
	})

	it('points at the prerequisites section that installs pnpm', () => {
		expect(pnpm_reach.NOT_ON_PATH_NOTICE).toContain(PREREQUISITES_ANCHOR)
	})
})
