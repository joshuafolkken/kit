import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { doctor_logic } from './doctor-logic'

const GLOBAL_JOSH = '/Users/me/Library/pnpm/josh'
const SHIM_JOSH = '/Users/me/.local/bin/josh'
const KIT_SHIM_CONTENT = '#!/bin/sh\nexec node_modules/.bin/tsx node_modules/@joshuafolkken/kit/...'
const FOREIGN_CONTENT = '#!/bin/sh\nexec some-other-tool "$@"'

describe('doctor_logic.is_shadowed', () => {
	it('reports shadowing when the PATH josh differs from the pnpm-global install', () => {
		expect(doctor_logic.is_shadowed(SHIM_JOSH, GLOBAL_JOSH)).toBe(true)
	})

	it('reports no shadowing when both paths resolve to the same install', () => {
		expect(doctor_logic.is_shadowed(GLOBAL_JOSH, GLOBAL_JOSH)).toBe(false)
	})

	it('normalizes paths before comparing', () => {
		const unnormalized = path.join(GLOBAL_JOSH, '..', 'josh')

		expect(doctor_logic.is_shadowed(unnormalized, GLOBAL_JOSH)).toBe(false)
	})

	it('cannot prove shadowing when the PATH josh is unknown', () => {
		expect(doctor_logic.is_shadowed(undefined, GLOBAL_JOSH)).toBe(false)
	})

	it('cannot prove shadowing when the global install is unknown', () => {
		expect(doctor_logic.is_shadowed(SHIM_JOSH, undefined)).toBe(false)
	})
})

describe('doctor_logic.path_lookup_command', () => {
	it('uses where on Windows', () => {
		expect(doctor_logic.path_lookup_command('win32')).toBe('where')
	})

	it('uses which on POSIX platforms', () => {
		expect(doctor_logic.path_lookup_command('darwin')).toBe('which')
		expect(doctor_logic.path_lookup_command('linux')).toBe('which')
	})
})

describe('doctor_logic.first_path_line', () => {
	it('skips the WARN line pnpm prepends and returns the path', () => {
		const noisy =
			'[WARN] Using --global skips the package manager check\n/Users/me/Library/pnpm/bin'

		expect(doctor_logic.first_path_line(noisy)).toBe('/Users/me/Library/pnpm/bin')
	})

	it('returns the first match when a lookup lists several paths', () => {
		const multiple = `${SHIM_JOSH}\n/Users/me/Library/pnpm/bin/josh`

		expect(doctor_logic.first_path_line(multiple)).toBe(SHIM_JOSH)
	})

	it('recognizes a Windows drive-letter absolute path', () => {
		const windows_path = String.raw`C:\Users\me\AppData\josh.cmd`

		expect(doctor_logic.first_path_line(windows_path)).toBe(windows_path)
	})

	it('returns the single path line for clean output', () => {
		expect(doctor_logic.first_path_line(`${SHIM_JOSH}\n`)).toBe(SHIM_JOSH)
	})

	it('returns undefined when no absolute path line is present', () => {
		expect(doctor_logic.first_path_line('[WARN] something went wrong\n')).toBeUndefined()
	})

	it('returns undefined for empty output', () => {
		expect(doctor_logic.first_path_line('')).toBeUndefined()
	})
})

describe('doctor_logic.is_kit_shim', () => {
	it('recognizes a shim that references the kit package', () => {
		expect(doctor_logic.is_kit_shim(KIT_SHIM_CONTENT)).toBe(true)
	})

	it('recognizes a shim that references the removed install-bin script', () => {
		expect(doctor_logic.is_kit_shim('exec tsx scripts/install-bin.ts')).toBe(true)
	})

	it('does not flag an unrelated binary as a kit shim', () => {
		expect(doctor_logic.is_kit_shim(FOREIGN_CONTENT)).toBe(false)
	})
})

describe('doctor_logic.decide_reclaim', () => {
	it('removes a stale kit shim that shadows the global install', () => {
		const decision = doctor_logic.decide_reclaim(SHIM_JOSH, GLOBAL_JOSH, KIT_SHIM_CONTENT)

		expect(decision.action).toBe('remove')
		expect(decision.target).toBe(SHIM_JOSH)
	})

	it('leaves a non-kit shadowing binary untouched', () => {
		const decision = doctor_logic.decide_reclaim(SHIM_JOSH, GLOBAL_JOSH, FOREIGN_CONTENT)

		expect(decision.action).toBe('none')
		expect(decision.reason).toBe(doctor_logic.NOT_KIT_SHIM_REASON)
	})

	it('does nothing when there is no shadowing', () => {
		const decision = doctor_logic.decide_reclaim(GLOBAL_JOSH, GLOBAL_JOSH, KIT_SHIM_CONTENT)

		expect(decision.action).toBe('none')
		expect(decision.reason).toBe(doctor_logic.NO_SHADOW_REASON)
	})
})

describe('doctor_logic.format_shadow_warning', () => {
	it('names both paths and the recovery command', () => {
		const warning = doctor_logic.format_shadow_warning(SHIM_JOSH, GLOBAL_JOSH)

		expect(warning).toContain(SHIM_JOSH)
		expect(warning).toContain(GLOBAL_JOSH)
		expect(warning).toContain(doctor_logic.RECOVERY_COMMAND)
	})
})
