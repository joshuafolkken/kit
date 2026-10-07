import { describe, expect, it } from 'vitest'
import { package_manager_pin } from './package-manager-pin'

const KIT_PIN = 'pnpm@12.6.0+sha512.abc'
const NEWER_AGENT = 'pnpm/12.10.0 npm/? node/v24.9.0 darwin arm64'

describe('package_manager_pin.running_pnpm_version', () => {
	it('reads the version of the pnpm that invoked the command', () => {
		expect(package_manager_pin.running_pnpm_version(NEWER_AGENT)).toBe('12.10.0')
	})

	it('answers nothing for another package manager or no user agent', () => {
		expect(package_manager_pin.running_pnpm_version('npm/11.6.0 node/v24.9.0')).toBeUndefined()
		expect(package_manager_pin.running_pnpm_version('yarn/4.10.0 npm/? node/v24')).toBeUndefined()
		expect(package_manager_pin.running_pnpm_version()).toBeUndefined()
	})

	it('answers nothing for a version semver cannot read', () => {
		expect(package_manager_pin.running_pnpm_version('pnpm/next node/v24')).toBeUndefined()
	})
})

// A project installed by a newer pnpm used to be pinned back to kit's older pnpm, which then failed
// to resolve the lockfile the newer one had just written (joshuafolkken/kit#3367).
describe('package_manager_pin.choose', () => {
	it('pins the running pnpm when it is newer than the kit pin', () => {
		expect(package_manager_pin.choose(KIT_PIN, NEWER_AGENT)).toBe('pnpm@12.10.0')
	})

	it('keeps the kit pin with its integrity suffix when the running pnpm is older', () => {
		expect(package_manager_pin.choose(KIT_PIN, 'pnpm/12.1.0 node/v24')).toBe(KIT_PIN)
	})

	it('keeps the kit pin when the running pnpm is the same version', () => {
		expect(package_manager_pin.choose(KIT_PIN, 'pnpm/12.6.0 node/v24')).toBe(KIT_PIN)
	})

	it('keeps the kit pin when pnpm did not invoke the command', () => {
		expect(package_manager_pin.choose(KIT_PIN, 'npm/11.6.0 node/v24')).toBe(KIT_PIN)
		expect(package_manager_pin.choose(KIT_PIN, undefined)).toBe(KIT_PIN)
	})

	it('answers nothing when kit carries no pin', () => {
		expect(package_manager_pin.choose(undefined, NEWER_AGENT)).toBeUndefined()
	})
})
