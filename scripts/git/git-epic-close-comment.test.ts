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
const EPIC = { children: LOCAL_CHILDREN, external_children: NO_EXTERNAL }
const ENLARGED_EPIC = { children: [...LOCAL_CHILDREN, 103], external_children: NO_EXTERNAL }
const LEGACY_ANNOUNCEMENT = `All child issues are closed (#101, #102). ${CLOSE_ANNOUNCEMENT}`

function comment_listing(bodies: Array<string>): string {
	return JSON.stringify(bodies.map((body) => ({ body })))
}

function quote_of(body: string): string {
	const quoted = body
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n')

	return `The auto-close said:\n\n${quoted}\n\nSo the batch is done.`
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

	it('still reads to a person as the announcement', () => {
		expect(build_close_comment(EPIC)).toContain(CLOSE_ANNOUNCEMENT)
	})

	// The marker is an HTML comment, so GitHub renders nothing for it — which is what stops a quote of
	// the visible sentence from answering "already announced" (joshuafolkken/kit#1068).
	it('ends with a marker that renders as nothing and names the children', () => {
		const last_line = build_close_comment(EPIC).split('\n').at(-1) ?? ''

		expect(last_line.startsWith('<!--')).toBe(true)
		expect(last_line.endsWith('-->')).toBe(true)
		expect(last_line).toContain('#101')
	})
})

describe('read_close_comment_state — the order the children are listed in', () => {
	// The set is what identifies the announcement; the order the epic happens to list its children in
	// is not, so reordering a task list must not read as a different announcement.
	it('reads an announcement listing the same children in another order', async () => {
		const reordered = { children: [102, 101], external_children: NO_EXTERNAL }

		mocked_comments.mockResolvedValue(comment_listing([build_close_comment(reordered)]))

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('present')
	})
})

describe('read_close_comment_state', () => {
	it('answers absent when no comment carries the announcement', async () => {
		mocked_comments.mockResolvedValue(comment_listing([PLAN_COMMENT, 'a decision log']))

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('absent')
	})

	it('answers absent for an epic with no comments at all', async () => {
		mocked_comments.mockResolvedValue('[]')

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('absent')
	})

	// The half-succeeded run: the announcement landed, the state change did not.
	it('answers present when a previous run already posted the announcement', async () => {
		mocked_comments.mockResolvedValue(comment_listing([PLAN_COMMENT, build_close_comment(EPIC)]))

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('present')
	})

	// REST serves a comment with no body as JSON null, which the schema accepts and the marker test
	// has to survive.
	it('tolerates a comment whose body is null', async () => {
		mocked_comments.mockResolvedValue(NULL_BODY_LISTING)

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('absent')
	})

	it('reads the listing of the epic it was given', async () => {
		mocked_comments.mockResolvedValue('[]')

		await read_close_comment_state(EPIC_NUMBER, EPIC)

		expect(mocked_comments).toHaveBeenCalledWith(EPIC_NUMBER)
	})
})

// joshuafolkken/kit#1068, problem 1: people and agents quote the auto-close output in ordinary
// comments. While the fixed sentence was the marker, any such quote answered "already announced" and
// the epic closed with no comment at all — losing the record of which children it closed against.
describe('read_close_comment_state — a comment quoting the announcement', () => {
	it('does not read a quoted legacy announcement as the announcement', async () => {
		mocked_comments.mockResolvedValue(comment_listing([quote_of(LEGACY_ANNOUNCEMENT)]))

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('absent')
	})

	// A "Quote reply" copies the raw markdown, marker included — but every line arrives behind `> `.
	it('does not read a quoted current announcement as the announcement', async () => {
		const quoted = quote_of(build_close_comment(EPIC))

		mocked_comments.mockResolvedValue(comment_listing([quoted]))

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('absent')
	})

	// A fenced block reproduces the marker line verbatim, `> ` prefix and all absent.
	it('does not read a fenced copy of the announcement as the announcement', async () => {
		const fenced = `The auto-close said:\n\n\`\`\`\n${build_close_comment(EPIC)}\n\`\`\`\n`

		mocked_comments.mockResolvedValue(comment_listing([fenced]))

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('absent')
	})

	// Four spaces open a code block too, and nothing about them survives a `trim()`.
	it('does not read an indented copy of the announcement as the announcement', async () => {
		const indented = build_close_comment(EPIC)
			.split('\n')
			.map((line) => `    ${line}`)
			.join('\n')

		mocked_comments.mockResolvedValue(comment_listing([`The auto-close said:\n\n${indented}\n`]))

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('absent')
	})

	it('does not read the sentence embedded in prose as the announcement', async () => {
		mocked_comments.mockResolvedValue(
			comment_listing([`The run printed "${CLOSE_ANNOUNCEMENT}" and stopped.`]),
		)

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('absent')
	})
})

// The migration path. Announcements posted before the marker existed carry only the prose, and an
// epic half-closed under that release must not receive the second comment joshuafolkken/kit#1039
// removed. Delete this suite together with `is_legacy_announcement`.
describe('read_close_comment_state — an announcement posted before the marker existed', () => {
	it('answers present for a marker-less announcement', async () => {
		mocked_comments.mockResolvedValue(comment_listing([PLAN_COMMENT, LEGACY_ANNOUNCEMENT]))

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('present')
	})

	// The old announcement recorded no child set, so nothing about it can be compared against one.
	it('answers present for a marker-less announcement naming other children', async () => {
		mocked_comments.mockResolvedValue(
			comment_listing([`All child issues are closed (#999). ${CLOSE_ANNOUNCEMENT}`]),
		)

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('present')
	})
})

// joshuafolkken/kit#1068, problem 2: an epic that was reopened, gained a child and completed again
// used to close in silence, because the announcement it already carried matched. The marker names
// the set it was posted for, so the enlarged batch is announced on its own terms.
describe('read_close_comment_state — an epic that gained a child after announcing', () => {
	it('answers absent when the announcement named a smaller set', async () => {
		mocked_comments.mockResolvedValue(comment_listing([build_close_comment(EPIC)]))

		expect(await read_close_comment_state(EPIC_NUMBER, ENLARGED_EPIC)).toBe('absent')
	})
})

// `unreadable` is never folded into `absent`: a listing nobody could read says nothing about what is
// on the issue, and posting on that answer is the duplicate this whole check exists to prevent.
describe('read_close_comment_state — a listing that could not be read', () => {
	it('answers unreadable when the request produced nothing', async () => {
		mocked_comments.mockResolvedValue(undefined)

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('unreadable')
	})

	it('answers unreadable for output that is not json', async () => {
		mocked_comments.mockResolvedValue('not json at all')

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('unreadable')
	})

	// The rate-limit shape: valid JSON, but an object rather than a listing.
	it('answers unreadable for valid json that is not a listing', async () => {
		mocked_comments.mockResolvedValue('{"message":"API rate limit exceeded"}')

		expect(await read_close_comment_state(EPIC_NUMBER, EPIC)).toBe('unreadable')
	})

	// A shape the schema rejects answers here too rather than throwing: this answer decides whether a
	// write posts, so an exception in place of the safe answer is the one outcome it must not produce.
	it('answers unreadable for rows the comment schema rejects', async () => {
		mocked_comments.mockResolvedValue('["not a comment object"]')

		await expect(read_close_comment_state(EPIC_NUMBER, EPIC)).resolves.toBe('unreadable')
	})
})
