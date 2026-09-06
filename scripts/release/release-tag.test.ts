import { git_gh_api_path } from '#scripts/git/git-gh-api-path'
import { describe, expect, it } from 'vitest'
import { release_tag } from './release-tag'

const VERSION = '1.342.0'
const ONE_MINUTE_SECONDS = 60

describe('release_tag.tag_name', () => {
	it('matches the tag auto-tag.yml creates', () => {
		expect(release_tag.tag_name(VERSION)).toBe('v1.342.0')
	})
})

describe('release_tag.configured_timeout_seconds', () => {
	it('takes a positive override', () => {
		expect(release_tag.configured_timeout_seconds('120')).toBe(120)
	})

	it('falls back for anything that is not a positive number', () => {
		expect(release_tag.configured_timeout_seconds(undefined)).toBe(
			release_tag.DEFAULT_TIMEOUT_SECONDS,
		)
		expect(release_tag.configured_timeout_seconds('0')).toBe(release_tag.DEFAULT_TIMEOUT_SECONDS)
		expect(release_tag.configured_timeout_seconds('later')).toBe(
			release_tag.DEFAULT_TIMEOUT_SECONDS,
		)
	})
})

describe('release_tag.attempts_for', () => {
	it('covers the whole budget', () => {
		const attempts = release_tag.attempts_for(ONE_MINUTE_SECONDS)

		expect(attempts * release_tag.TAG_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(60_000)
	})

	it('always makes at least one attempt', () => {
		expect(release_tag.attempts_for(1)).toBeGreaterThanOrEqual(1)
	})
})

describe('release_tag.format_result', () => {
	it('names the tag when it exists', () => {
		expect(release_tag.format_result(VERSION, true)).toContain('v1.342.0 exists')
	})

	// The whole point of the watch: a merge that produced no tag published nothing, and reporting it
	// as a success is the failure joshuafolkken/kit#1169 §3 exists to prevent.
	it('reports a missing tag as a failure, not as a slow success', () => {
		const text = release_tag.format_result(VERSION, false)

		expect(text).toContain('never appeared')
		expect(text).toContain('nothing was published')
	})
})

describe('the tag reference path', () => {
	it('addresses the single ref REST answers 404 for when it is absent', () => {
		expect(git_gh_api_path.tag_ref_api_path('v1.342.0')).toBe(
			'repos/{owner}/{repo}/git/ref/tags/v1.342.0',
		)
	})
})
