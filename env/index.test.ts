import { describe, expect, it } from 'vitest'
import { environment_flags } from './index.js'

// The vocabulary is the interface: consumers type these exact spellings into shell commands and CI
// settings, so each one is asserted literally rather than derived from the module's own set.
const TRUTHY_SPELLINGS: ReadonlyArray<string> = ['1', 'true', 'yes', 'on']
const FALSY_SPELLINGS: ReadonlyArray<string> = ['0', 'false', 'no', 'off']

// #828: a `vite.config.ts` clone of this predicate accepted only '1'/'true', so `ANALYZE=yes`
// silently did nothing in the same repository where `PLAYWRIGHT_REUSE_SERVER=yes` worked. The
// spellings beyond the falsy set that must still read as "off" for an opt-in flag:
const NON_AFFIRMATIVE_VALUES: ReadonlyArray<string> = ['', ' ', '2', 'enabled', 'TRUE!']

// Real providers export provider names, not booleans — Woodpecker sets `CI=woodpecker`.
const PROVIDER_CI_VALUES: ReadonlyArray<string> = ['woodpecker', 'true', '1', 'GitHub-Actions']

describe('environment_flags.is_flag_enabled', () => {
	it.each(TRUTHY_SPELLINGS)('enables on %j', (value) => {
		expect(environment_flags.is_flag_enabled(value)).toBe(true)
	})

	it.each(TRUTHY_SPELLINGS)('normalizes case and whitespace around %j', (value) => {
		expect(environment_flags.is_flag_enabled(` ${value.toUpperCase()} `)).toBe(true)
	})

	it.each(FALSY_SPELLINGS)('stays off on the explicit negative %j', (value) => {
		expect(environment_flags.is_flag_enabled(value)).toBe(false)
	})

	it.each(NON_AFFIRMATIVE_VALUES)('stays off on the non-affirmative %j', (value) => {
		expect(environment_flags.is_flag_enabled(value)).toBe(false)
	})

	it('stays off when the variable is unset', () => {
		expect(environment_flags.is_flag_enabled(undefined)).toBe(false)
	})
})

describe('environment_flags.is_ci_enabled', () => {
	it.each(PROVIDER_CI_VALUES)('reads the provider value %j as CI', (value) => {
		expect(environment_flags.is_ci_enabled(value)).toBe(true)
	})

	it.each(FALSY_SPELLINGS)('opts out on the explicit negative %j', (value) => {
		expect(environment_flags.is_ci_enabled(value)).toBe(false)
	})

	it.each(FALSY_SPELLINGS)('opts out on %j regardless of case and whitespace', (value) => {
		expect(environment_flags.is_ci_enabled(` ${value.toUpperCase()} `)).toBe(false)
	})

	it('reads an empty value as not CI', () => {
		expect(environment_flags.is_ci_enabled('')).toBe(false)
	})

	it('reads a whitespace-only value as not CI', () => {
		expect(environment_flags.is_ci_enabled('  ')).toBe(false)
	})

	it('reads an unset variable as not CI', () => {
		expect(environment_flags.is_ci_enabled(undefined)).toBe(false)
	})
})

describe('environment_flags.normalize_flag_value', () => {
	it('lowercases and trims', () => {
		expect(environment_flags.normalize_flag_value('  YeS\t')).toBe('yes')
	})

	it('returns an already-normalized value unchanged', () => {
		expect(environment_flags.normalize_flag_value('on')).toBe('on')
	})
})
