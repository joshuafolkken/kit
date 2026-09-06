import { describe, expect, it } from 'vitest'
import { release_plan, type ReleasePlan } from './release-plan'

const BASE_SHA = 'abcdef1234567890'
const CURRENT = '1.339.0'
const PREVIOUS = '1.338.0'
const OLDEST = '1.337.0'
const NEXT = '1.342.0'
const THREE = 3
const THREE_PENDING_LINE = 'unreleased merges on main: 3'

describe('release_plan.find_version_base', () => {
	it('answers the newest commit whose version differs from the one before it', () => {
		const commits = [
			{ sha: 'c3', version: '1.340.0' },
			{ sha: 'c2', version: CURRENT },
			{ sha: 'c1', version: PREVIOUS },
		]

		expect(release_plan.find_version_base(commits, OLDEST)).toBe('c3')
	})

	it('skips a package.json commit that left the version alone', () => {
		const commits = [
			{ sha: 'deps', version: CURRENT },
			{ sha: 'release', version: CURRENT },
			{ sha: 'older', version: PREVIOUS },
		]

		expect(release_plan.find_version_base(commits, OLDEST)).toBe('release')
	})

	it('compares the oldest commit against the version before it', () => {
		const commits = [{ sha: 'only', version: CURRENT }]

		expect(release_plan.find_version_base(commits, PREVIOUS)).toBe('only')
		expect(release_plan.find_version_base(commits, CURRENT)).toBeUndefined()
	})

	it('answers undefined when nothing in range changed the version', () => {
		expect(release_plan.find_version_base([], undefined)).toBeUndefined()
	})
})

describe('release_plan.find_version_base against unreadable revisions', () => {
	// A revision whose package.json could not be read makes the comparison above it unanswerable.
	// Declaring a base there would pick one too new, under-count the merges since it, and ship fewer
	// minors than issues — silently, which is what this command exists to prevent.
	it('does not declare a base against an unreadable neighbor', () => {
		const commits = [
			{ sha: 'newest', version: CURRENT },
			{ sha: 'unreadable', version: undefined },
			{ sha: 'oldest', version: PREVIOUS },
		]

		expect(release_plan.find_version_base(commits, OLDEST)).toBe('oldest')
	})

	it('falls back to the parent version only at the end of the list', () => {
		const commits = [{ sha: 'only', version: CURRENT }]

		expect(release_plan.previous_version_of(commits, 0, OLDEST)).toBe(OLDEST)
		const with_unreadable = [...commits, { sha: 'x', version: undefined }]

		expect(release_plan.previous_version_of(with_unreadable, 0, OLDEST)).toBeUndefined()
	})
})

describe('release_plan.next_version', () => {
	it('raises the minor once per pending merge', () => {
		expect(release_plan.next_version(CURRENT, THREE)).toBe(NEXT)
	})

	// The arithmetic zeroes the patch, so a version with a non-zero patch is the case that catches a
	// missing zero branch — `1.339.4` must not come back as the downgrade `1.339.0`.
	it('leaves the version alone when nothing is pending', () => {
		expect(release_plan.next_version(CURRENT, 0)).toBe(CURRENT)
		expect(release_plan.next_version('1.339.4', 0)).toBe('1.339.4')
	})

	it('zeroes the patch, so a sequence of releases still accounts for every merge', () => {
		expect(release_plan.next_version('1.339.4', 1)).toBe('1.340.0')
	})

	it('rejects a version it cannot parse', () => {
		expect(() => release_plan.next_version('not-a-version', 1)).toThrow('Invalid version format')
	})
})

describe('release_plan formatting', () => {
	it('names the count in the line a person reads', () => {
		expect(release_plan.format_pending_line(THREE)).toContain(THREE_PENDING_LINE)
	})

	it('says nothing is pending without proposing a version', () => {
		const text = release_plan.format_nothing_to_release(BASE_SHA)

		expect(text).toContain('unreleased merges on main: 0')
		expect(text).toContain('Nothing to release')
		expect(text).toContain(release_plan.short_sha(BASE_SHA))
	})

	it('names the base, the current version and the next one', () => {
		const plan: ReleasePlan = {
			base: BASE_SHA,
			pending: THREE,
			current_version: CURRENT,
			next_version: NEXT,
		}
		const text = release_plan.format_plan(plan)

		expect(text).toContain(THREE_PENDING_LINE)
		expect(text).toContain(CURRENT)
		expect(text).toContain(NEXT)
	})
})
