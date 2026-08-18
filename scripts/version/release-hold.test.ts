import { describe, expect, it } from 'vitest'
import { release_hold } from './release-hold'

const NOW = Date.parse('2026-08-18T12:00:00Z')
const HOUR_MS = 3_600_000
const DAY_MINUTES = 1440

// A history where the newest release is two hours old — inside a 24 h window — and the one before it
// is three days old, so the quarantine withholds `latest` and permits its predecessor.
// Registry `time` objects key on version strings, which the object-literal naming rule rejects as
// inline property names; building them from entries keeps the fixtures legal.
function times_of(entries: ReadonlyArray<[string, string]>): Record<string, string> {
	return Object.fromEntries(entries)
}

const LATEST = '1.80.0'
const AGED = '1.79.0'
const OLDER = '1.78.0'
const PRERELEASE = '1.81.0-rc.1'
const TIMES = times_of([
	[LATEST, new Date(NOW - 2 * HOUR_MS).toISOString()],
	[AGED, new Date(NOW - 72 * HOUR_MS).toISOString()],
	[OLDER, new Date(NOW - 96 * HOUR_MS).toISOString()],
])

function installable(times: Record<string, string> | undefined): string | undefined {
	return release_hold.resolve_installable(times, LATEST, DAY_MINUTES, NOW)
}

describe('resolve_installable', () => {
	it('returns the newest release that has aged past the window', () => {
		expect(installable(TIMES)).toBe(AGED)
	})

	// Once latest has aged out there is no hold to explain, so the caller gets nothing rather than
	// latest itself — which would render the degenerate "an unpinned resolve lands on <latest>".
	it('returns nothing once latest has aged out of the window', () => {
		expect(release_hold.resolve_installable(TIMES, LATEST, 60, NOW)).toBeUndefined()
	})

	it('returns nothing when the timestamps are unavailable', () => {
		expect(installable(undefined)).toBeUndefined()
	})

	it('returns nothing when every release is still inside the window', () => {
		const only_newest = times_of([[LATEST, TIMES[LATEST] ?? '']])

		expect(release_hold.resolve_installable(only_newest, LATEST, DAY_MINUTES, NOW)).toBeUndefined()
	})

	// A freshly published major is exactly when the previous line is the only thing installable, so
	// the search must not be scoped to latest's major (joshuafolkken/kit#808).
	it('offers an aged release from an earlier major', () => {
		const across_majors = times_of([
			['2.0.0', new Date(NOW - 2 * HOUR_MS).toISOString()],
			[AGED, new Date(NOW - 72 * HOUR_MS).toISOString()],
		])

		expect(release_hold.resolve_installable(across_majors, '2.0.0', DAY_MINUTES, NOW)).toBe(AGED)
	})
})

describe('is_release_age_hold', () => {
	it('is true for an install sitting at the newest installable release', () => {
		expect(release_hold.is_release_age_hold(AGED, LATEST, AGED)).toBe(true)
	})

	// The distinction the whole feature exists to draw: genuinely behind, so the upgrade hint applies.
	it('is false for an install behind the newest installable release', () => {
		expect(release_hold.is_release_age_hold(OLDER, LATEST, AGED)).toBe(false)
	})

	it('is false for an install already at latest', () => {
		expect(release_hold.is_release_age_hold(LATEST, LATEST, LATEST)).toBe(false)
	})

	it('is false when the install is absent', () => {
		expect(release_hold.is_release_age_hold(undefined, LATEST, AGED)).toBe(false)
	})

	it('is false when the installable release is unknown', () => {
		expect(release_hold.is_release_age_hold(AGED, LATEST, undefined)).toBe(false)
	})
})

describe('format_window', () => {
	it('renders a whole number of hours', () => {
		expect(release_hold.format_window(DAY_MINUTES)).toBe('24 h')
	})

	it('renders minutes when the window is not a whole number of hours', () => {
		expect(release_hold.format_window(90)).toBe('90 min')
	})
})

describe('build_release_hold_notes', () => {
	it('names both the withheld release and the installed one', () => {
		const [note] = release_hold.build_release_hold_notes(AGED, LATEST, AGED, DAY_MINUTES)

		expect(note).toContain(LATEST)
		expect(note).toContain(AGED)
		expect(note).toContain('24 h')
	})

	it('states the window rather than only that a hold exists', () => {
		const [note] = release_hold.build_release_hold_notes(AGED, LATEST, AGED, DAY_MINUTES)

		expect(note).toContain('minimum-release-age')
	})

	it('emits nothing for a genuinely stale install, leaving the upgrade hint to speak', () => {
		expect(release_hold.build_release_hold_notes(OLDER, LATEST, AGED, DAY_MINUTES)).toStrictEqual(
			[],
		)
	})

	it('emits nothing for an install already at latest', () => {
		expect(
			release_hold.build_release_hold_notes(LATEST, LATEST, LATEST, DAY_MINUTES),
		).toStrictEqual([])
	})

	it('emits nothing when the installable release is unknown', () => {
		expect(
			release_hold.build_release_hold_notes(AGED, LATEST, undefined, DAY_MINUTES),
		).toStrictEqual([])
	})
})

describe('is_release_age_hold — ahead of the installable release', () => {
	// An install can sit ahead of the newest release the page shows as aged out — installed before the
	// policy tightened, or published between that page and latest — and still be behind latest. The
	// same policy refuses an upgrade there, so it is a hold rather than staleness.
	it('is true for an install between the installable release and latest', () => {
		expect(release_hold.is_release_age_hold('1.79.5', LATEST, AGED)).toBe(true)
	})

	it('is false for an install below the installable release', () => {
		expect(release_hold.is_release_age_hold('1.78.5', LATEST, AGED)).toBe(false)
	})

	// Unparseable versions cannot be ordered, so the comparison falls back to equality rather than
	// guessing.
	it('falls back to equality when a version is not valid semver', () => {
		expect(release_hold.is_release_age_hold('nightly', LATEST, 'nightly')).toBe(true)
		expect(release_hold.is_release_age_hold('nightly', LATEST, AGED)).toBe(false)
	})
})

// A hold exists only when `latest` is itself inside the window. Without that precondition the note
// fires whenever the aged selection differs from `latest` for any other reason.
describe('resolve_installable requires latest to be withheld', () => {
	it('returns nothing when latest is a prerelease the selector filters out', () => {
		const with_prerelease = times_of([
			[PRERELEASE, new Date(NOW - 720 * HOUR_MS).toISOString()],
			[AGED, new Date(NOW - 72 * HOUR_MS).toISOString()],
		])

		expect(
			release_hold.resolve_installable(with_prerelease, PRERELEASE, DAY_MINUTES, NOW),
		).toBeUndefined()
	})

	it('returns nothing when latest is absent from the fetched page', () => {
		expect(release_hold.resolve_installable(TIMES, '9.9.9', DAY_MINUTES, NOW)).toBeUndefined()
	})

	it('returns nothing when latest carries an unparseable publish date', () => {
		const bad_date = times_of([
			[LATEST, 'not-a-date'],
			[AGED, new Date(NOW - 72 * HOUR_MS).toISOString()],
		])

		expect(release_hold.resolve_installable(bad_date, LATEST, DAY_MINUTES, NOW)).toBeUndefined()
	})
})
