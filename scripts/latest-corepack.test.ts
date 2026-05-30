import { describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'

const PACKAGE_JSON_V11 = '{"packageManager":"pnpm@11.4.0+sha512.abc"}'
const PACKAGE_JSON_V10 = '{"packageManager":"pnpm@10.34.1+sha512.def"}'
const PACKAGE_JSON_V11_SHORT = '{"packageManager":"pnpm@11"}'
const PACKAGE_JSON_NO_PM = '{"name":"kit"}'
const TARGET_V11 = 'pnpm@latest-11'

describe('latest_corepack.extract_pnpm_major', () => {
	it('extracts the major from a packageManager pnpm pin', () => {
		expect(latest_corepack.extract_pnpm_major(PACKAGE_JSON_V11)).toBe('11')
	})

	it('extracts the major from a bare pnpm@<major> shorthand pin', () => {
		expect(latest_corepack.extract_pnpm_major(PACKAGE_JSON_V11_SHORT)).toBe('11')
	})

	it('returns undefined when packageManager is absent', () => {
		expect(latest_corepack.extract_pnpm_major(PACKAGE_JSON_NO_PM)).toBeUndefined()
	})
})

describe('latest_corepack.build_corepack_target', () => {
	it('targets pnpm per-major latest dist-tag', () => {
		expect(latest_corepack.build_corepack_target('11')).toBe(TARGET_V11)
	})

	it('falls back to pnpm@latest when the major is undefined', () => {
		expect(latest_corepack.build_corepack_target(undefined)).toBe('pnpm@latest')
	})
})

describe('latest_corepack.resolve_corepack_target', () => {
	it('resolves a v11 pin to latest-11, never below devEngines', () => {
		expect(latest_corepack.resolve_corepack_target(PACKAGE_JSON_V11)).toBe(TARGET_V11)
	})

	it('resolves a v10 pin to latest-10, not the volatile latest tag', () => {
		expect(latest_corepack.resolve_corepack_target(PACKAGE_JSON_V10)).toBe('pnpm@latest-10')
	})
})

describe('latest_corepack.warn_if_skipped', () => {
	it('warns and reports a skip when corepack exits non-zero', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(latest_corepack.warn_if_skipped(1)).toBe(true)
		expect(warn).toHaveBeenCalledOnce()

		warn.mockRestore()
	})

	it('stays silent and reports no skip when corepack succeeds', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(latest_corepack.warn_if_skipped(0)).toBe(false)
		expect(warn).not.toHaveBeenCalled()

		warn.mockRestore()
	})
})
