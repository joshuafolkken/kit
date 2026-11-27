import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge_follow_up } from './run-merge-follow-up'

// joshuafolkken/kit#9063: a merged child's follow-up lines with no `FILED` event of its own are named
// as the parent's filing lines; a filed one is not; a failed read skips with one line.

const { read_with_comments, all_events } = vi.hoisted(() => ({
	read_with_comments: vi.fn<() => Promise<{ comments_json: string | undefined }>>(),
	all_events: vi.fn<() => Promise<ReadonlyArray<FiledEvent>>>(),
}))

interface FiledEvent {
	readonly found_during: string
	readonly text: string
}

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_read_with_comments: read_with_comments },
}))
vi.mock('#scripts/issue/issue-read', () => ({
	issue_read: {
		parse_comments: async (json: string | undefined) =>
			json === undefined ? undefined : [{ body: json, is_trusted: true }],
		trusted_bodies: (comments: ReadonlyArray<{ body: string }>) =>
			comments.map((comment) => comment.body),
	},
}))
vi.mock('#scripts/issue/issue-file-fold', () => ({
	issue_file_fold: {
		events_of: all_events,
		finder_filings: (events: ReadonlyArray<FiledEvent>, child: string) =>
			events
				.filter((event) => event.found_during === child)
				.map((event) => ({ title: event.text })),
	},
}))

const CHILD = '9063'
const OTHER_CHILD = '9064'
const EVIDENCE = 'result\n後続: Shorten the probe\n後続: Drop the retry\n'
const PROBE = 'Shorten the probe'
const RETRY = 'Drop the retry'
const infos: Array<string> = []

beforeEach(() => {
	infos.length = 0
	read_with_comments.mockReset().mockResolvedValue({ comments_json: EVIDENCE })
	all_events.mockReset().mockResolvedValue([{ found_during: CHILD, text: RETRY }])
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		infos.push(String(line))
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_merge_follow_up.check', () => {
	it('names the follow-up no filing of the child carries, as the parent filing line', async () => {
		await run_merge_follow_up.check(CHILD)

		const printed = infos.join('\n')

		expect(printed).toContain(`issue:file '${PROBE}' --found-during ${CHILD}`)
		expect(printed).not.toContain(RETRY)
	})

	it('does not count a same-title filing found during another child', async () => {
		all_events.mockResolvedValue([{ found_during: OTHER_CHILD, text: RETRY }])

		await run_merge_follow_up.check(CHILD)

		expect(infos.join('\n')).toContain(`issue:file '${RETRY}' --found-during ${CHILD}`)
	})

	it('prints nothing once every follow-up is filed', async () => {
		all_events.mockResolvedValue([
			{ found_during: CHILD, text: PROBE },
			{ found_during: CHILD, text: RETRY },
		])

		await run_merge_follow_up.check(CHILD)

		expect(infos).toStrictEqual([])
	})

	it('skips with one line and does not throw when the comments are not read', async () => {
		read_with_comments.mockRejectedValue(new Error('gh down'))

		await expect(run_merge_follow_up.check(CHILD)).resolves.toBeUndefined()
		expect(infos).toStrictEqual([`Follow-up check skipped for #${CHILD}: gh down`])
	})
})
