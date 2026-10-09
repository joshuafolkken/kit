import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_cite } from './issue-cite'
import { session_cite } from './session-cite'

// joshuafolkken/kit#3424: what a josh command prints is copied into the session's reply, so an Issue it
// names is printed in the form the Stop guard accepts — linked to the repository the command runs in.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const NUMBER = 3424

function stub_origin(url: string | undefined): void {
	vi.spyOn(repo_discovery, 'read_origin_url').mockReturnValue(url)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('session_cite.session_repo', () => {
	it('reads owner/repo off an HTTPS origin', () => {
		stub_origin(`https://github.com/${REPO}.git`)

		expect(session_cite.session_repo()).toBe(REPO)
	})

	it('reads owner/repo off an SSH origin', () => {
		stub_origin(`git@github.com:${REPO}.git`)

		expect(session_cite.session_repo()).toBe(REPO)
	})

	it('answers undefined without a GitHub origin', () => {
		stub_origin(undefined)

		expect(session_cite.session_repo()).toBeUndefined()
	})
})

describe('session_cite.issue', () => {
	it('links the number to the work tree repository', () => {
		stub_origin(`https://github.com/${REPO}`)

		expect(session_cite.issue(NUMBER)).toBe(
			`[#${String(NUMBER)}](${issue_cite.issue_url(REPO, String(NUMBER))})`,
		)
	})

	it('adds the title when the caller holds it', () => {
		stub_origin(`https://github.com/${REPO}`)

		expect(session_cite.issue(NUMBER, 'A title')).toBe(
			issue_cite.citation_line(REPO, String(NUMBER), 'A title'),
		)
	})

	it('links another repository when one is named', () => {
		stub_origin(`https://github.com/${REPO}`)

		expect(session_cite.issue(NUMBER, undefined, OTHER_REPO)).toBe(
			`[#${String(NUMBER)}](${issue_cite.issue_url(OTHER_REPO, String(NUMBER))})`,
		)
	})

	it('keeps the plain number without a GitHub origin', () => {
		stub_origin(undefined)

		expect(session_cite.issue(NUMBER)).toBe(`#${String(NUMBER)}`)
	})
})

describe('session_cite.text', () => {
	it('links every bare number in a printed line', () => {
		stub_origin(`https://github.com/${REPO}`)

		expect(session_cite.text(`Added #${String(NUMBER)} to epic #1.`)).toBe(
			`Added ${session_cite.issue(NUMBER)} to epic ${session_cite.issue(1)}.`,
		)
	})

	it('leaves a number that is already linked as it is', () => {
		stub_origin(`https://github.com/${REPO}`)
		const linked = `entry ${session_cite.issue(NUMBER)} — resume: resume`

		expect(session_cite.text(linked)).toBe(linked)
	})

	it('keeps the text as it is without a GitHub origin', () => {
		stub_origin(undefined)

		expect(session_cite.text(`stage #${String(NUMBER)}`)).toBe(`stage #${String(NUMBER)}`)
	})
})
