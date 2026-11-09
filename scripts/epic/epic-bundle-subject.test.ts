import { git_gh_command } from '#scripts/gh/git-gh-command'
import { listing_of } from '#scripts/gh/git-gh-issue-list-fixture'
import { describe, expect, it, vi } from 'vitest'
import { epic_bundle_cli } from './epic-bundle-cli'
import { epic_bundle_referenced, type ReferencedContext } from './epic-bundle-referenced'

// joshuafolkken/kit#6796: a just-filed issue trails the open listing. Re-reading the whole backlog
// until it appeared cost every open issue's requests again per attempt, so the subject the listing
// does not show is read on its own, once.

const REPO = 'joshuafolkken/kit'
const SUBJECT = 10
const EPIC = 100
const TITLE = 'Cut the filing calls'

const CONTEXT: ReferencedContext = {
	repo: REPO,
	epics: new Map([[SUBJECT, EPIC]]),
	epic_numbers: new Set([EPIC]),
}

function read_json(state: string, kind = 'issues'): string {
	return JSON.stringify({
		number: SUBJECT,
		title: TITLE,
		body: '',
		state,
		url: `https://github.com/${REPO}/${kind}/${String(SUBJECT)}`,
		labels: [],
	})
}

function mock_read(json: string): void {
	vi.spyOn(git_gh_command, 'issue_get_plan_fields_classified').mockResolvedValue({
		kind: 'read',
		json,
	})
}

describe('epic_bundle_referenced.read_subject', () => {
	it('answers an open issue with its title and the epic tracking it', async () => {
		mock_read(read_json('OPEN'))

		expect(await epic_bundle_referenced.read_subject(SUBJECT, CONTEXT)).toMatchObject({
			number: SUBJECT,
			title: TITLE,
			epic: EPIC,
		})
	})

	it('answers nothing for a closed issue', async () => {
		mock_read(read_json('CLOSED'))

		expect(await epic_bundle_referenced.read_subject(SUBJECT, CONTEXT)).toBeUndefined()
	})

	it('answers nothing for a pull request', async () => {
		mock_read(read_json('OPEN', 'pull'))

		expect(await epic_bundle_referenced.read_subject(SUBJECT, CONTEXT)).toBeUndefined()
	})

	it('answers nothing for a read that failed', async () => {
		vi.spyOn(git_gh_command, 'issue_get_plan_fields_classified').mockResolvedValue({
			kind: 'unreadable',
			reason: 'unreachable',
			status: undefined,
		})

		expect(await epic_bundle_referenced.read_subject(SUBJECT, CONTEXT)).toBeUndefined()
	})
})

describe('epic_bundle_cli.report_for — a subject the listing does not show yet', () => {
	it('reads the backlog once and the subject on its own', async () => {
		vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(listing_of([]))
		const backlog = vi
			.spyOn(git_gh_command, 'issue_list_open_relations')
			.mockResolvedValue(listing_of([]))

		mock_read(read_json('OPEN'))
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await epic_bundle_cli.report_for(SUBJECT, REPO)).toBe(0)
		expect(backlog).toHaveBeenCalledOnce()
		expect(git_gh_command.issue_get_plan_fields_classified).toHaveBeenCalledOnce()
	})
})
