import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_ANNOUNCEMENT, git_epic_close_comment } from './git-epic-close-comment'

const { build_close_comment, read_close_comment_state } = git_epic_close_comment

vi.mock('./git-gh-command', () => ({
	git_gh_command: { issue_list_comments: vi.fn() },
}))

const { git_gh_command } = await import('./git-gh-command')
const mocked_comments = vi.mocked(git_gh_command.issue_list_comments)

const EPIC_NUMBER = '200'
const LOCAL_CHILDREN = [101, 102]
const REMOTE_CHILD = { repo: 'joshuafolkken/app-kit', number: 7 }
const NO_EXTERNAL: Array<never> = []
const PLAN_COMMENT = 'a plan comment'
const NULL_BODY_LISTING = '[{"body":null}]'

function comment_listing(bodies: Array<string>): string {
	return JSON.stringify(bodies.map((body) => ({ body })))
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('build_close_comment', () => {
	it('names every child, near and far', () => {
		const comment = build_close_comment({
			children: LOCAL_CHILDREN,
			external_children: [REMOTE_CHILD],
		})

		expect(comment).toContain('#101, #102, joshuafolkken/app-kit#7')
	})

	// The marker is not written beside the comment, it is written *into* it — so a rephrasing can
	// never leave the retry check matching a sentence the comment no longer contains.
	it('ends with the marker the retry check matches on', () => {
		const comment = build_close_comment({
			children: LOCAL_CHILDREN,
			external_children: NO_EXTERNAL,
		})

		expect(comment.endsWith(CLOSE_ANNOUNCEMENT)).toBe(true)
	})
})

describe('read_close_comment_state', () => {
	it('answers absent when no comment carries the announcement', async () => {
		mocked_comments.mockResolvedValue(comment_listing([PLAN_COMMENT, 'a decision log']))

		expect(await read_close_comment_state(EPIC_NUMBER)).toBe('absent')
	})

	it('answers absent for an epic with no comments at all', async () => {
		mocked_comments.mockResolvedValue('[]')

		expect(await read_close_comment_state(EPIC_NUMBER)).toBe('absent')
	})

	// The half-succeeded run: the announcement landed, the state change did not.
	it('answers present when a previous run already posted the announcement', async () => {
		mocked_comments.mockResolvedValue(
			comment_listing([
				PLAN_COMMENT,
				build_close_comment({ children: LOCAL_CHILDREN, external_children: NO_EXTERNAL }),
			]),
		)

		expect(await read_close_comment_state(EPIC_NUMBER)).toBe('present')
	})

	// The child list varies with the epic; the marker does not. Matching the whole body would read a
	// posted announcement naming different children as "not posted yet".
	it('matches the marker rather than the whole body', async () => {
		mocked_comments.mockResolvedValue(
			comment_listing([`All child issues are closed (#999). ${CLOSE_ANNOUNCEMENT}`]),
		)

		expect(await read_close_comment_state(EPIC_NUMBER)).toBe('present')
	})

	// REST serves a comment with no body as JSON null, which the schema accepts and the marker test
	// has to survive.
	it('tolerates a comment whose body is null', async () => {
		mocked_comments.mockResolvedValue(NULL_BODY_LISTING)

		expect(await read_close_comment_state(EPIC_NUMBER)).toBe('absent')
	})

	it('reads the listing of the epic it was given', async () => {
		mocked_comments.mockResolvedValue('[]')

		await read_close_comment_state(EPIC_NUMBER)

		expect(mocked_comments).toHaveBeenCalledWith(EPIC_NUMBER)
	})
})

// `unreadable` is never folded into `absent`: a listing nobody could read says nothing about what is
// on the issue, and posting on that answer is the duplicate this whole check exists to prevent.
describe('read_close_comment_state — a listing that could not be read', () => {
	it('answers unreadable when the request produced nothing', async () => {
		mocked_comments.mockResolvedValue(undefined)

		expect(await read_close_comment_state(EPIC_NUMBER)).toBe('unreadable')
	})

	it('answers unreadable for output that is not json', async () => {
		mocked_comments.mockResolvedValue('not json at all')

		expect(await read_close_comment_state(EPIC_NUMBER)).toBe('unreadable')
	})

	// The rate-limit shape: valid JSON, but an object rather than a listing.
	it('answers unreadable for valid json that is not a listing', async () => {
		mocked_comments.mockResolvedValue('{"message":"API rate limit exceeded"}')

		expect(await read_close_comment_state(EPIC_NUMBER)).toBe('unreadable')
	})

	// A shape the schema rejects answers here too rather than throwing: this answer decides whether a
	// write posts, so an exception in place of the safe answer is the one outcome it must not produce.
	it('answers unreadable for rows the comment schema rejects', async () => {
		mocked_comments.mockResolvedValue('["not a comment object"]')

		await expect(read_close_comment_state(EPIC_NUMBER)).resolves.toBe('unreadable')
	})
})
