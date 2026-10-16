import { git_gh_command } from '#scripts/gh/git-gh-command'
import { listing_of } from '#scripts/gh/git-gh-issue-list-fixture'
import { RELEASE_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { epic_bundle, type BacklogIssue } from './epic-bundle'
import { epic_bundle_cli } from './epic-bundle-cli'
import { epic_bundle_fixture } from './epic-bundle-fixture'
import { epic_bundle_referenced } from './epic-bundle-referenced'
import type { EpicIssue } from './epic-issue'

// joshuafolkken/kit#3810: `issue:file --release` records every change awaiting publication as a
// blocker of the release issue. That relation is mechanical, so `epic:bundle` read it as a strong
// signal and proposed one epic holding the release and an unrelated change.

const REPO = 'joshuafolkken/kit'
const RELEASE = 3709
const SUBJECT = 3810
const RELATED = 3811
const NO_BLOCKERS = 0

function issue(number: number, overrides: Partial<BacklogIssue> = {}): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], is_epic: false, ...overrides }
}

function release_waiting_on(blocked: number): BacklogIssue {
	return issue(RELEASE, { is_release: true, blocked_by: [{ repo: REPO, number: blocked }] })
}

const NO_EPICS = { repo: REPO, epics: new Map<number, number>(), epic_numbers: new Set<number>() }

afterEach(() => {
	vi.restoreAllMocks()
})

describe('epic_bundle.decide_bundle — the release issue is never a candidate', () => {
	it('finds nothing to bundle when the release issue is the only one waiting on it', () => {
		const decision = epic_bundle.decide_bundle(issue(SUBJECT), [release_waiting_on(SUBJECT)])

		expect(decision.action).toBe('none')
	})

	it('finds nothing to bundle when asked about the release issue itself', () => {
		const subject = release_waiting_on(SUBJECT)

		expect(epic_bundle.decide_bundle(subject, [issue(SUBJECT)]).action).toBe('none')
	})

	it('still bundles over a dependency recorded with an ordinary issue', () => {
		const related = issue(RELATED, { blocked_by: [{ repo: REPO, number: SUBJECT }] })
		const backlog = [release_waiting_on(SUBJECT), related]

		expect(epic_bundle.decide_bundle(issue(SUBJECT), backlog)).toMatchObject({
			action: 'create_epic',
			candidates: [RELATED],
		})
	})

	it('still bundles over a reference written in prose', () => {
		const subject = issue(SUBJECT, {
			body: epic_bundle_fixture.in_acceptance(`follows #${String(RELATED)}`),
		})
		const backlog = [release_waiting_on(SUBJECT), issue(RELATED)]

		expect(epic_bundle.decide_bundle(subject, backlog).candidates).toEqual([RELATED])
	})
})

describe('epic_bundle — reading the release label', () => {
	it('marks a listing row carrying the release label', async () => {
		const row = { number: RELEASE, title: '', body: '', blocked_by_count: NO_BLOCKERS }

		vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(
			listing_of([
				{ ...row, labels: [{ name: RELEASE_LABEL }] },
				{ ...row, number: SUBJECT, labels: [{ name: 'bug' }] },
			]),
		)

		const { issues } = await epic_bundle_cli.fetch_backlog(REPO, new Map())

		expect(issues.map((entry) => entry.is_release)).toEqual([true, false])
	})

	it('marks a referenced issue carrying the release label', () => {
		const read: EpicIssue = {
			number: RELEASE,
			title: '',
			body: '',
			state: 'OPEN',
			url: `https://github.com/${REPO}/issues/${String(RELEASE)}`,
			labels: [{ name: RELEASE_LABEL }],
			blockedBy: undefined,
		}

		const found = epic_bundle_referenced.collect_referenced(
			[{ number: RELEASE, result: read }],
			NO_EPICS,
		)

		expect(found.issues[0]?.is_release).toBe(true)
	})
})
