import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_consolidate, type ConsolidateRequest } from './issue-consolidate'

const gh = vi.hoisted(() => ({
	issue_view_json: vi.fn<(issue: string, fields: string) => Promise<string | undefined>>(),
	issue_edit_title: vi.fn<(issue: string, title: string) => Promise<string>>(),
	issue_edit_body: vi.fn<(issue: string, body: string) => Promise<string>>(),
	issue_remove_label: vi.fn<(issue: string, label: string) => Promise<void>>(),
	issue_close:
		vi.fn<(issue: string, comment: string | undefined, reason?: string) => Promise<boolean>>(),
}))
const { fetch_epics, build_tracking_index, untrack, is_author_trusted } = vi.hoisted(() => ({
	fetch_epics: vi.fn<() => Promise<{ cutoff: string; epics: Array<unknown> } | undefined>>(),
	build_tracking_index: vi.fn<() => Map<number, ReadonlyArray<number>>>(),
	untrack: vi.fn<(epic: number, children: ReadonlyArray<number>) => Promise<number>>(),
	is_author_trusted: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: gh }))
vi.mock('#scripts/epic/epic-untrack', () => ({ epic_untrack: { untrack } }))
vi.mock('./issue-body-or-comment', () => ({ issue_body_or_comment: { is_author_trusted } }))
vi.mock('#scripts/epic/epic-index', () => ({
	epic_index: { fetch_epics, build_tracking_index },
}))

const TARGET = 6559
const DUPLICATE = 6567
const OTHER_DUPLICATE = 6568
const EPIC = 6581
const ORIGINAL = 'Original text.\n'
const PROMOTED_BODY = `${ORIGINAL}\n## Split into children\n\n- [ ] #6600\n`
const NEW_BODY = 'Merged scope.\n'
const NEW_TITLE = 'Merged'
const RATE_LIMITED = 'API rate limit exceeded'

function target_json(labels: ReadonlyArray<string>): string {
	return JSON.stringify({ body: PROMOTED_BODY, labels: labels.map((name) => ({ name })) })
}

function request(overrides: Partial<ConsolidateRequest> = {}): ConsolidateRequest {
	return {
		target: TARGET,
		duplicates: [DUPLICATE],
		title: undefined,
		body: undefined,
		is_demote: false,
		...overrides,
	}
}

function errors(): string {
	return vi.mocked(console.error).mock.calls.flat().join('\n')
}

function arrange_gh(): void {
	gh.issue_view_json.mockResolvedValue(target_json(['Epic', 'enhancement']))
	gh.issue_edit_title.mockResolvedValue('')
	gh.issue_edit_body.mockResolvedValue('')
	gh.issue_remove_label.mockResolvedValue(undefined)
	gh.issue_close.mockResolvedValue(true)
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	arrange_gh()
	fetch_epics.mockResolvedValue({ cutoff: 'none', epics: [] })
	build_tracking_index.mockReturnValue(new Map([[DUPLICATE, [EPIC, EPIC]]]))
	untrack.mockResolvedValue(0)
	is_author_trusted.mockResolvedValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('issue_consolidate duplicates', () => {
	it('removes each duplicate from its epic once, then closes it as not planned with a comment', async () => {
		expect(await issue_consolidate.consolidate(request())).toBe(0)
		expect(untrack).toHaveBeenCalledExactlyOnceWith(EPIC, [DUPLICATE])
		expect(gh.issue_close).toHaveBeenCalledExactlyOnceWith(
			String(DUPLICATE),
			expect.stringContaining(String(TARGET)),
			'not_planned',
		)
		expect(untrack.mock.invocationCallOrder[0]).toBeLessThan(
			gh.issue_close.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('closes an untracked duplicate without touching any epic', async () => {
		expect(await issue_consolidate.consolidate(request({ duplicates: [OTHER_DUPLICATE] }))).toBe(0)
		expect(untrack).not.toHaveBeenCalled()
		expect(gh.issue_close).toHaveBeenCalledOnce()
	})
})

describe('issue_consolidate target', () => {
	it('replaces the title and body, and leaves the epic label alone without --demote', async () => {
		const outcome = await issue_consolidate.consolidate(
			request({ title: NEW_TITLE, body: NEW_BODY }),
		)

		expect(outcome).toBe(0)
		expect(gh.issue_edit_title).toHaveBeenCalledExactlyOnceWith(String(TARGET), NEW_TITLE)
		expect(gh.issue_edit_body).toHaveBeenCalledExactlyOnceWith(String(TARGET), NEW_BODY)
		expect(gh.issue_remove_label).not.toHaveBeenCalled()
	})

	it('drops the promoted epic sections and the stored epic label on --demote', async () => {
		expect(await issue_consolidate.consolidate(request({ is_demote: true }))).toBe(0)
		expect(gh.issue_edit_body).toHaveBeenCalledExactlyOnceWith(String(TARGET), ORIGINAL)
		expect(gh.issue_remove_label).toHaveBeenCalledExactlyOnceWith(String(TARGET), 'Epic')
	})

	it('removes a duplicate from the target epic before demoting the target', async () => {
		build_tracking_index.mockReturnValue(new Map([[DUPLICATE, [TARGET]]]))

		expect(await issue_consolidate.consolidate(request({ is_demote: true }))).toBe(0)
		expect(untrack).toHaveBeenCalledExactlyOnceWith(TARGET, [DUPLICATE])
		expect(untrack.mock.invocationCallOrder[0]).toBeLessThan(
			gh.issue_edit_body.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('writes neither body nor label when there is nothing to change', async () => {
		gh.issue_view_json.mockResolvedValue(JSON.stringify({ body: ORIGINAL, labels: [] }))

		expect(await issue_consolidate.consolidate(request({ is_demote: true }))).toBe(0)
		expect(gh.issue_edit_body).not.toHaveBeenCalled()
		expect(gh.issue_remove_label).not.toHaveBeenCalled()
	})
})

describe('issue_consolidate refusals before any write', () => {
	it.each([
		['the target cannot be read', () => gh.issue_view_json.mockResolvedValue(undefined)],
		[
			'the epic listing is cut short',
			() => fetch_epics.mockResolvedValue({ cutoff: 'row_limit', epics: [] }),
		],
		['the epic listing fails', () => fetch_epics.mockResolvedValue(undefined)],
		['the target author is untrusted', () => is_author_trusted.mockResolvedValue(false)],
	])('writes nothing when %s', async (_case, arrange) => {
		arrange()

		expect(await issue_consolidate.consolidate(request({ body: NEW_BODY }))).toBe(1)
		expect(gh.issue_edit_body).not.toHaveBeenCalled()
		expect(gh.issue_close).not.toHaveBeenCalled()
		expect(errors()).toContain('nothing was written')
	})
})

describe('issue_consolidate partial failures', () => {
	it('stops at a rate-limited write and lists the writes already done', async () => {
		gh.issue_edit_body.mockRejectedValue(new Error(RATE_LIMITED))

		const outcome = await issue_consolidate.consolidate(
			request({ title: NEW_TITLE, body: NEW_BODY }),
		)

		expect(outcome).toBe(1)
		expect(gh.issue_close).not.toHaveBeenCalled()
		expect(errors()).toContain(RATE_LIMITED)
		expect(errors()).toMatch(/Already written[\s\S]*title/u)
		expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('✔'))
	})

	it('reports a refused close of a later duplicate after the earlier one closed', async () => {
		gh.issue_close.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

		const outcome = await issue_consolidate.consolidate(
			request({ duplicates: [DUPLICATE, OTHER_DUPLICATE] }),
		)

		expect(outcome).toBe(1)
		expect(errors()).toMatch(new RegExp(`Failed: .*${String(OTHER_DUPLICATE)}`, 'u'))
		expect(errors()).toMatch(
			new RegExp(String.raw`Already written[\s\S]*${String(DUPLICATE)}`, 'u'),
		)
	})

	it('leaves the duplicate open when its untrack fails', async () => {
		untrack.mockResolvedValue(1)

		expect(await issue_consolidate.consolidate(request())).toBe(1)
		expect(gh.issue_close).not.toHaveBeenCalled()
	})
})
