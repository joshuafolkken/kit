import { describe, expect, it } from 'vitest'
import { release_age } from './release-age'

const MAJOR = '11'
const AGE_1440 = 1440
const WORKSPACE_WITHOUT_WINDOW = 'engineStrict: true\n'
const NOW_MS = Date.parse('2026-08-04T12:00:00.000Z')
const OLD_ENOUGH = '2026-08-01T00:00:00.000Z'
const TOO_YOUNG = '2026-08-04T11:00:00.000Z'
const V11_19 = '11.19.0'
const V11_20 = '11.20.0'

// Registry `time` objects key on version strings, which the object-literal naming rule
// rejects as inline property names; building them from entries keeps the fixtures legal.
function times_of(entries: ReadonlyArray<[string, string]>): Record<string, string> {
	return Object.fromEntries(entries)
}

describe('release_age.parse_minimum_release_age', () => {
	it('reads the minutes from a minimumReleaseAge key', () => {
		expect(release_age.parse_minimum_release_age('minimumReleaseAge: 1440\n')).toBe(AGE_1440)
	})

	it('finds the key among other workspace settings', () => {
		const workspace = 'packages:\n  - .\nminimumReleaseAge: 1440\nengineStrict: true\n'

		expect(release_age.parse_minimum_release_age(workspace)).toBe(AGE_1440)
	})

	it('defaults to no quarantine when the setting is absent', () => {
		expect(release_age.parse_minimum_release_age(WORKSPACE_WITHOUT_WINDOW)).toBe(0)
	})

	it('defaults to no quarantine for a non-numeric value', () => {
		expect(release_age.parse_minimum_release_age('minimumReleaseAge: soon\n')).toBe(0)
	})

	it('defaults to no quarantine for a non-integer value', () => {
		expect(release_age.parse_minimum_release_age('minimumReleaseAge: 1.5\n')).toBe(0)
	})

	it('defaults to no quarantine for a malformed document', () => {
		expect(release_age.parse_minimum_release_age('minimumReleaseAge: [1440\n')).toBe(0)
	})

	// pnpm 12 ignores an age line in `.npmrc`, so the reader must not report one as the policy.
	it('ignores the legacy npmrc spelling', () => {
		expect(release_age.parse_minimum_release_age('minimum-release-age=1440\n')).toBe(0)
	})
})

describe('release_age.parse_declared_minimum_release_age', () => {
	it('keeps an explicit zero distinct from an undeclared window', () => {
		expect(release_age.parse_declared_minimum_release_age('minimumReleaseAge: 0\n')).toBe(0)
		expect(release_age.parse_declared_minimum_release_age(WORKSPACE_WITHOUT_WINDOW)).toBeUndefined()
	})
})

describe('release_age.select_aged_version window handling', () => {
	it('picks the newest release when every candidate has aged past the window', () => {
		const times = times_of([
			[V11_19, OLD_ENOUGH],
			[V11_20, OLD_ENOUGH],
		])

		expect(release_age.select_aged_version(times, MAJOR, AGE_1440, NOW_MS)).toBe(V11_20)
	})

	it('falls back to the next release when the newest is still inside the window', () => {
		const times = times_of([
			[V11_19, OLD_ENOUGH],
			[V11_20, TOO_YOUNG],
		])

		expect(release_age.select_aged_version(times, MAJOR, AGE_1440, NOW_MS)).toBe(V11_19)
	})

	it('returns undefined when every release is still inside the window', () => {
		const times = times_of([
			[V11_19, TOO_YOUNG],
			[V11_20, TOO_YOUNG],
		])

		expect(release_age.select_aged_version(times, MAJOR, AGE_1440, NOW_MS)).toBeUndefined()
	})

	it('applies no filtering when the quarantine window is zero', () => {
		const times = times_of([
			[V11_19, OLD_ENOUGH],
			[V11_20, TOO_YOUNG],
		])

		expect(release_age.select_aged_version(times, MAJOR, 0, NOW_MS)).toBe(V11_20)
	})
})

describe('release_age.select_aged_version candidate filtering', () => {
	it('ignores prereleases, other majors, and the created/modified bookkeeping keys', () => {
		const times = times_of([
			['created', '2019-01-01T00:00:00.000Z'],
			['modified', OLD_ENOUGH],
			['10.34.5', OLD_ENOUGH],
			['12.0.0-beta.4', OLD_ENOUGH],
			[V11_19, OLD_ENOUGH],
		])

		expect(release_age.select_aged_version(times, MAJOR, AGE_1440, NOW_MS)).toBe(V11_19)
	})

	it('ignores a release whose publish timestamp is unparsable', () => {
		const times = times_of([
			[V11_19, OLD_ENOUGH],
			[V11_20, 'not-a-date'],
		])

		expect(release_age.select_aged_version(times, MAJOR, AGE_1440, NOW_MS)).toBe(V11_19)
	})

	// The kit#768 point: the answer is a pure function of (times, major, window, now) — it
	// cannot differ between `josh latest` and `pnpm josh latest` the way the safe-chain
	// interception did, because no ambient state participates.
	it('answers identically for identical inputs, independent of invocation context', () => {
		const times = times_of([
			[V11_19, OLD_ENOUGH],
			[V11_20, TOO_YOUNG],
		])
		const first = release_age.select_aged_version(times, MAJOR, AGE_1440, NOW_MS)
		const second = release_age.select_aged_version({ ...times }, MAJOR, AGE_1440, NOW_MS)

		expect(first).toBe(second)
	})
})
