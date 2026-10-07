import { describe, expect, it } from 'vitest'
import { issue_release } from './issue-release'

// joshuafolkken/kit#3360: the pure answers behind `josh issue:release` — which open release Issue a
// listing names, and what a new one is filed with.

const REPO = 'joshuafolkken/kit'

describe('issue_release.open_release_of', () => {
	it('names the oldest open release Issue of a newest-first listing', () => {
		expect(issue_release.open_release_of('[{"number":42},{"number":7}]')).toBe(7)
	})

	it('names none when the listing is empty', () => {
		expect(issue_release.open_release_of('[]')).toBeUndefined()
	})

	it.each(['not json', '{"number":7}', '[{"title":"x"}]'])(
		'names none for an unreadable listing: %s',
		(json) => {
			expect(issue_release.open_release_of(json)).toBeUndefined()
		},
	)
})

describe('issue_release — the filed release Issue', () => {
	it('is titled after its repository', () => {
		expect(issue_release.title_of(REPO)).toBe(`Release ${REPO} (next version)`)
	})

	it('carries the release label and never auto-ok', () => {
		expect(issue_release.RELEASE_LABELS).toContain('release')
		expect(issue_release.RELEASE_LABELS).not.toContain('auto-ok')
	})

	it('names the command a person runs to release', () => {
		expect(issue_release.body_of(REPO)).toContain('pnpm josh release')
	})

	// Nothing closes it automatically, so a release Issue left open would gather already-published
	// blockers beside the unreleased ones.
	it('tells the person to close it once the release is published', () => {
		expect(issue_release.body_of(REPO)).toContain('Close this Issue once that release is published')
	})
})
