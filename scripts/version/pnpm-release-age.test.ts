import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pnpm_release_age, type Packument } from './pnpm-release-age'

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))

const mocked_read_file_sync = vi.mocked(readFileSync)
const fetch_spy = vi.spyOn(globalThis, 'fetch')

const DEFAULT_WINDOW_MINUTES = 1440
const MS_PER_MINUTE = 60_000
const NOW_MS = Date.parse('2026-07-13T00:00:00.000Z')
const TAG_11 = 'latest-11'
const TAG_10 = 'latest-10'
const V11 = '11.12.0'

function packument_of(
	distribution_tags: Record<string, string>,
	time: Record<string, string>,
): Packument {
	return { 'dist-tags': distribution_tags, time }
}

function published_minutes_ago(minutes: number): string {
	return new Date(NOW_MS - minutes * MS_PER_MINUTE).toISOString()
}

function ok_response(body: unknown): Response {
	return { ok: true, json: vi.fn().mockResolvedValue(body) } as unknown as Response
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('pnpm_release_age.parse_minimum_release_age_minutes', () => {
	it('reads the configured window from an .npmrc line', () => {
		expect(pnpm_release_age.parse_minimum_release_age_minutes('minimum-release-age=4320')).toBe(
			4320,
		)
	})

	it('tolerates surrounding whitespace around the assignment', () => {
		expect(pnpm_release_age.parse_minimum_release_age_minutes('  minimum-release-age = 60 ')).toBe(
			60,
		)
	})

	it('falls back to the default when the line is absent', () => {
		expect(pnpm_release_age.parse_minimum_release_age_minutes('engine-strict=true')).toBe(
			DEFAULT_WINDOW_MINUTES,
		)
	})
})

describe('pnpm_release_age.read_minimum_release_age_minutes', () => {
	it('parses the window from the .npmrc file contents', () => {
		mocked_read_file_sync.mockReturnValue('minimum-release-age=2880')

		expect(pnpm_release_age.read_minimum_release_age_minutes()).toBe(2880)
	})

	it('falls back to the default when the file cannot be read', () => {
		mocked_read_file_sync.mockImplementation(() => {
			throw new Error('ENOENT')
		})

		expect(pnpm_release_age.read_minimum_release_age_minutes()).toBe(DEFAULT_WINDOW_MINUTES)
	})
})

describe('pnpm_release_age.resolve_distribution_tag_release', () => {
	const PUBLISHED = '2026-07-11T00:00:00.000Z'
	const PACKUMENT = packument_of({ [TAG_11]: V11, [TAG_10]: '10.34.1' }, { [V11]: PUBLISHED })

	it('resolves the version and publish time behind pnpm@latest-<major>', () => {
		expect(pnpm_release_age.resolve_distribution_tag_release(PACKUMENT, '11')).toEqual({
			version: V11,
			published_at: PUBLISHED,
		})
	})

	it('returns undefined when the dist-tag is missing', () => {
		expect(pnpm_release_age.resolve_distribution_tag_release(PACKUMENT, '9')).toBeUndefined()
	})

	it('returns undefined when the resolved version has no publish time', () => {
		expect(pnpm_release_age.resolve_distribution_tag_release(PACKUMENT, '10')).toBeUndefined()
	})
})

describe('pnpm_release_age.is_release_too_new', () => {
	it('reports too-new when the release is younger than the window', () => {
		expect(
			pnpm_release_age.is_release_too_new(
				published_minutes_ago(60),
				NOW_MS,
				DEFAULT_WINDOW_MINUTES,
			),
		).toBe(true)
	})

	it('reports safe once the release has aged past the window', () => {
		const published_at = published_minutes_ago(2 * DEFAULT_WINDOW_MINUTES)

		expect(pnpm_release_age.is_release_too_new(published_at, NOW_MS, DEFAULT_WINDOW_MINUTES)).toBe(
			false,
		)
	})

	it('treats a malformed timestamp as not too new (fail-open)', () => {
		expect(pnpm_release_age.is_release_too_new('not-a-date', NOW_MS, DEFAULT_WINDOW_MINUTES)).toBe(
			false,
		)
	})
})

function stub_registry_release(published_at: string): void {
	mocked_read_file_sync.mockReturnValue('minimum-release-age=1440')
	fetch_spy.mockResolvedValue(ok_response(packument_of({ [TAG_11]: V11 }, { [V11]: published_at })))
}

describe('pnpm_release_age.resolve_hold_decision', () => {
	afterEach(() => {
		fetch_spy.mockReset()
	})

	it('holds the bump when the candidate version is inside the window', async () => {
		stub_registry_release(published_minutes_ago(60))

		await expect(pnpm_release_age.resolve_hold_decision('11', NOW_MS)).resolves.toEqual({
			is_held: true,
			version: V11,
			window_minutes: DEFAULT_WINDOW_MINUTES,
		})
	})

	it('allows the bump once the candidate version has aged past the window', async () => {
		stub_registry_release(published_minutes_ago(2 * DEFAULT_WINDOW_MINUTES))

		await expect(pnpm_release_age.resolve_hold_decision('11', NOW_MS)).resolves.toEqual({
			is_held: false,
			version: V11,
			window_minutes: DEFAULT_WINDOW_MINUTES,
		})
	})

	it('does not hold when the major is undefined', async () => {
		await expect(pnpm_release_age.resolve_hold_decision(undefined, NOW_MS)).resolves.toEqual({
			is_held: false,
		})
		expect(fetch_spy).not.toHaveBeenCalled()
	})

	it('fails open when the registry fetch throws', async () => {
		fetch_spy.mockRejectedValue(new Error('network down'))

		await expect(pnpm_release_age.resolve_hold_decision('11', NOW_MS)).resolves.toEqual({
			is_held: false,
		})
	})
})
