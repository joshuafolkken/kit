import { git_gh_conditional, type ConditionalRead } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_merged } from './issue-merged'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

const exec_gh_api = vi.mocked(git_gh_exec.exec_gh_api)
const PER_PAGE = 100
const ETAG = 'W/"first"'
const NEW_ETAG = 'W/"second"'
const UNCHANGED: ConditionalRead = { kind: 'unchanged' }
const COMMENTED_EVENT = { event: 'commented', body: 'a note' }
// A full first page: more may follow, so the read falls to the paged one with the filter.
const FULL_BODY = JSON.stringify(Array.from({ length: PER_PAGE }, () => COMMENTED_EVENT))
const FULL_PAGE: ConditionalRead = { kind: 'changed', etag: undefined, body: FULL_BODY }
const MERGED = 'merged-reference\t'
const CLOSED = 'closed\t'
const CLOSED_COMPLETED = 'closed\tcompleted'
const CLOSED_NOT_PLANNED = 'closed\tnot_planned'
const REOPENED = 'reopened\t'
const LABELED = 'labeled\t'
const UNLABELED = 'unlabeled\t'
const READ_FAILURE = new Error('rate limited')

function rows(...lines: ReadonlyArray<string>): ReturnType<typeof issue_merged.parse_rows> {
	return issue_merged.parse_rows(lines.join('\n'))
}

beforeEach(() => {
	shared_cache_fixture.keep_in_memory()
	exec_gh_api.mockReset()
	vi.spyOn(git_gh_conditional, 'read_conditional').mockReset().mockResolvedValue(FULL_PAGE)
})

// joshuafolkken/kit#2701: a sweep deletes work on this answer, so only a close a merge explains counts.
describe('issue_merged.is_merged_close', () => {
	it.each([
		['closed by a merged pull request', [MERGED, CLOSED]],
		['closed as completed after a merged pull request', [MERGED, CLOSED_COMPLETED]],
		['reopened and closed again after a merge', [MERGED, CLOSED, REOPENED, CLOSED]],
	])('answers true when %s', (_label, lines) => {
		expect(issue_merged.is_merged_close(rows(...lines))).toBe(true)
	})

	it.each([
		['closed as not planned', [MERGED, CLOSED_NOT_PLANNED]],
		['closed as a duplicate', [MERGED, 'closed\tduplicate']],
		['closed with no merged pull request', [CLOSED_COMPLETED]],
		['reopened after the merge', [MERGED, CLOSED, REOPENED]],
		['still open', [MERGED]],
		['never touched', []],
	])('answers false when %s', (_label, lines) => {
		expect(issue_merged.is_merged_close(rows(...lines))).toBe(false)
	})
})

// joshuafolkken/kit#4475: a measurement-only issue has no pull request; `josh issue:measured` labels it
// `measured` and closes it, and every sweep reading this answer must count that close as the merge.
describe('issue_merged.is_merged_close — a measurement-only issue', () => {
	it.each([
		['labeled measured, then closed', [LABELED, CLOSED]],
		['labeled measured, then closed as completed', [LABELED, CLOSED_COMPLETED]],
	])('counts it as merged when %s', (_label, lines) => {
		expect(issue_merged.is_merged_close(rows(...lines))).toBe(true)
	})

	it.each([
		['labeled measured, then closed as not planned', [LABELED, CLOSED_NOT_PLANNED]],
		['labeled measured, closed, then reopened', [LABELED, CLOSED, REOPENED]],
		['labeled measured, then unlabeled before the close', [LABELED, UNLABELED, CLOSED]],
		['labeled measured and still open', [LABELED]],
	])('does not count it as merged when %s', (_label, lines) => {
		expect(issue_merged.is_merged_close(rows(...lines))).toBe(false)
	})
})

describe('issue_merged.read_merged', () => {
	it('reads the paged timeline of the issue', async () => {
		exec_gh_api.mockResolvedValue([MERGED, CLOSED].join('\n'))

		expect(await issue_merged.read_merged('2606')).toBe(true)
		expect(exec_gh_api).toHaveBeenCalledWith(
			expect.objectContaining({
				path: 'repos/{owner}/{repo}/issues/2606/timeline?per_page=100',
				should_paginate: true,
			}),
		)
	})

	it('asks the timeline for the measured label events', async () => {
		exec_gh_api.mockResolvedValue('')

		await issue_merged.read_merged('2606')

		expect(exec_gh_api.mock.calls[0]?.[0].jq_filter).toContain('.label.name == "measured"')
	})

	it('answers false when the read fails, so nothing is deleted on doubt', async () => {
		exec_gh_api.mockRejectedValue(READ_FAILURE)

		expect(await issue_merged.read_merged('2606')).toBe(false)
	})
})

describe('issue_merged.read_merge_state', () => {
	it.each([
		['merged', [MERGED, CLOSED], true],
		['not merged', [MERGED, CLOSED_NOT_PLANNED], false],
	])('answers the timeline when it reads, %s', async (_label, lines, expected) => {
		exec_gh_api.mockResolvedValue(lines.join('\n'))

		expect(await issue_merged.read_merge_state('2606')).toBe(expected)
	})

	it('answers nothing when the read fails, so a kept answer is not taken from a failure', async () => {
		exec_gh_api.mockRejectedValue(READ_FAILURE)

		expect(await issue_merged.read_merge_state('2606')).toBeUndefined()
	})
})

// Events as GitHub sends them, `null` included.
const MERGED_EVENT =
	'{"event":"cross-referenced","source":{"issue":{"pull_request":{"merged_at":"2026-11-07T00:00:00Z"}}}}'
const OPEN_PULL_EVENT =
	'{"event":"cross-referenced","source":{"issue":{"pull_request":{"merged_at":null}}}}'
const ISSUE_REFERENCE_EVENT = '{"event":"cross-referenced","source":{"issue":{"number":7}}}'
const NOTE_EVENT = JSON.stringify(COMMENTED_EVENT)
const CLOSED_EVENT = '{"event":"closed","state_reason":null}'
const CLOSED_COMPLETED_EVENT = '{"event":"closed","state_reason":"completed"}'
const CLOSED_NOT_PLANNED_EVENT = '{"event":"closed","state_reason":"not_planned"}'
const REOPENED_EVENT = '{"event":"reopened","state_reason":"reopened"}'
const LABELED_EVENT = '{"event":"labeled","label":{"name":"measured"}}'
const UNLABELED_EVENT = '{"event":"unlabeled","label":{"name":"measured"}}'
const OTHER_LABEL_EVENT = '{"event":"labeled","label":{"name":"bug"}}'

function page(...events: ReadonlyArray<string>): string {
	return `[${events.join(',')}]`
}

function changed(etag: string, ...events: ReadonlyArray<string>): ConditionalRead {
	return { kind: 'changed', etag, body: page(...events) }
}

function answer_with(...answers: ReadonlyArray<ConditionalRead>): void {
	const mocked = vi.mocked(git_gh_conditional.read_conditional)

	for (const answer of answers) mocked.mockResolvedValueOnce(answer)
}

function sent_etags(): Array<string | undefined> {
	return vi.mocked(git_gh_conditional.read_conditional).mock.calls.map(([, etag]) => etag)
}

// joshuafolkken/kit#6698: a first page read as JSON gives the rows `TIMELINE_FILTER` gives.
describe('issue_merged.page_rows', () => {
	it('builds the rows the timeline filter makes, dropping every other event', () => {
		const raw = page(
			OPEN_PULL_EVENT,
			ISSUE_REFERENCE_EVENT,
			MERGED_EVENT,
			NOTE_EVENT,
			CLOSED_EVENT,
			REOPENED_EVENT,
			OTHER_LABEL_EVENT,
			LABELED_EVENT,
			UNLABELED_EVENT,
			CLOSED_COMPLETED_EVENT,
			CLOSED_NOT_PLANNED_EVENT,
		)
		const expected = [MERGED, CLOSED, 'reopened\treopened', LABELED, UNLABELED]

		expect(issue_merged.page_rows(raw)).toStrictEqual(
			rows(...expected, CLOSED_COMPLETED, CLOSED_NOT_PLANNED),
		)
	})

	it.each([
		['a full page, which more may follow', FULL_BODY],
		['an answer that is no array', '{"message":"Not Found"}'],
		['an event of a shape the schema does not know', '[{"event":"labeled","label":{"name":null}}]'],
	])('answers nothing for %s, so the paged read takes over', (_label, raw) => {
		expect(issue_merged.page_rows(raw)).toBeUndefined()
	})
})

// joshuafolkken/kit#6698: the board re-reads a closed child's timeline every tick; an unchanged one
// is a 304, which costs no rate limit.
describe('issue_merged.read_merge_state — the ETag', () => {
	it('re-reads an unchanged timeline with a 304 and no unconditional gh api', async () => {
		answer_with(changed(ETAG, MERGED_EVENT, CLOSED_EVENT), UNCHANGED)

		expect(await issue_merged.read_merge_state('2606')).toBe(true)
		expect(await issue_merged.read_merge_state('2606')).toBe(true)
		expect(sent_etags()).toStrictEqual([undefined, ETAG])
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('reads the new events when the timeline changes', async () => {
		answer_with(
			changed(ETAG, MERGED_EVENT, CLOSED_EVENT),
			changed(NEW_ETAG, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT),
			UNCHANGED,
		)

		expect(await issue_merged.read_merge_state('2606')).toBe(true)
		expect(await issue_merged.read_merge_state('2606')).toBe(false)
		expect(await issue_merged.read_merge_state('2606')).toBe(false)
		expect(sent_etags()).toStrictEqual([undefined, ETAG, NEW_ETAG])
	})

	it('falls to the paged read with the filter when the first page is full', async () => {
		exec_gh_api.mockResolvedValue([MERGED, CLOSED].join('\n'))

		expect(await issue_merged.read_merge_state('2606')).toBe(true)
		expect(exec_gh_api).toHaveBeenCalledWith(
			expect.objectContaining({ should_paginate: true, jq_filter: expect.any(String) }),
		)
	})
})
