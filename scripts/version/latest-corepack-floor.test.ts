import { describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'

// The kit#766 pin floor: `josh latest` may only move the pnpm pin forward. These suites
// cover the pure comparison half; the main()-level no-op behavior stays in
// latest-corepack.test.ts beside the other main() arrangements.

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }))

const PACKAGE_JSON_V11 = '{"packageManager":"pnpm@11.4.0+sha512.abc"}'
const PACKAGE_JSON_V11_SHORT = '{"packageManager":"pnpm@11"}'
const PACKAGE_JSON_NO_PM = '{"name":"kit"}'
const PIN_V11_20 = '11.20.0'
const TARGET_BELOW_PIN = 'pnpm@11.19.0'
const TARGET_AT_PIN = 'pnpm@11.20.0'
const FALLBACK_TARGET = 'pnpm@latest'

describe('latest_corepack.extract_pinned_version', () => {
	it('extracts the full version without the integrity suffix', () => {
		expect(latest_corepack.extract_pinned_version(PACKAGE_JSON_V11)).toBe('11.4.0')
	})

	it('returns undefined for a bare-major shorthand pin', () => {
		expect(latest_corepack.extract_pinned_version(PACKAGE_JSON_V11_SHORT)).toBeUndefined()
	})

	it('returns undefined when the packageManager pin is absent', () => {
		expect(latest_corepack.extract_pinned_version(PACKAGE_JSON_NO_PM)).toBeUndefined()
	})
})

describe('latest_corepack.is_target_not_newer_than_pin', () => {
	it('flags a registry answer below the pin as not newer', () => {
		expect(latest_corepack.is_target_not_newer_than_pin(TARGET_BELOW_PIN, PIN_V11_20)).toBe(true)
	})

	it('flags an answer equal to the pin as not newer', () => {
		expect(latest_corepack.is_target_not_newer_than_pin(TARGET_AT_PIN, PIN_V11_20)).toBe(true)
	})

	it('lets a genuinely newer answer through', () => {
		expect(latest_corepack.is_target_not_newer_than_pin(TARGET_AT_PIN, '11.19.0')).toBe(false)
	})

	it('does not apply without a comparable pin', () => {
		expect(latest_corepack.is_target_not_newer_than_pin(TARGET_BELOW_PIN, undefined)).toBe(false)
	})

	it('does not apply to the pnpm@latest fallback target', () => {
		expect(latest_corepack.is_target_not_newer_than_pin(FALLBACK_TARGET, PIN_V11_20)).toBe(false)
	})
})

describe('latest_corepack.notify_skipped_bump', () => {
	it('logs the equal answer as steady-state success, not a warning', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		latest_corepack.notify_skipped_bump(TARGET_AT_PIN, PIN_V11_20)

		expect(info).toHaveBeenCalledOnce()
		expect(warn).not.toHaveBeenCalled()

		vi.restoreAllMocks()
	})

	it('warns when the answer sits below the pin', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		latest_corepack.notify_skipped_bump(TARGET_BELOW_PIN, PIN_V11_20)

		expect(warn).toHaveBeenCalledOnce()
		expect(info).not.toHaveBeenCalled()

		vi.restoreAllMocks()
	})
})
