import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pause_publish } from './run-pause-publish'

// joshuafolkken/kit#8086: a prerequisite filed prepared mid-run stayed unpublished while the run
// waiting on it read as an ordinary wait. Each write lands in an in-memory stand-in — the prepared
// child's body, the epics listing it, the comments per issue — so a rerun reads back the first run.

const PENDING_BODY = 'Body\n\n<!-- josh:publication {"labels":["run:lane"]} -->'

const state = vi.hoisted(() => ({
	body: '',
	epics: [] as Array<number>,
	withheld: undefined as string | undefined,
	published: [] as Array<number>,
	comments: new Map<string, Array<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { repo_get_name_with_owner: async () => 'o/r' },
}))

vi.mock('#scripts/epic/epic-live', () => ({
	epic_live: {
		child: async (number: number, repo: string) => ({
			number,
			repo,
			state: 'OPEN',
			labels: [],
			blocked_by: [],
			body: state.body,
		}),
	},
}))

vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { listing_epics: async () => state.epics },
}))

vi.mock('#scripts/issue/issue-publication', () => ({
	issue_publication: {
		publish: async (epic: number) => {
			if (state.withheld !== undefined) throw new Error(state.withheld)
			state.published.push(epic)
		},
	},
}))

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: {
		issue_list_comments: async (issue: string) =>
			JSON.stringify((state.comments.get(issue) ?? []).map((body) => ({ body }))),
	},
}))

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_comment: async (issue: string, body: string) => {
			state.comments.set(issue, [...(state.comments.get(issue) ?? []), body])

			return `https://github.com/o/r/issues/${issue}#issuecomment-1`
		},
	},
}))

const REQUEST = { issue: '10', prerequisite: '11' }
const WITHHELD = 'Publication withheld: #11 needs its recorded plan'

function comments_on(issue: string): ReadonlyArray<string> {
	return state.comments.get(issue) ?? []
}

beforeEach(() => {
	Object.assign(state, {
		body: PENDING_BODY,
		epics: [7],
		withheld: undefined,
		published: [],
		comments: new Map(),
	})
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('run_pause_publish.publish_prepared', () => {
	it('publishes the epic listing a prepared prerequisite whose plan is recorded', async () => {
		const detail = await run_pause_publish.publish_prepared(REQUEST)

		expect(state.published).toStrictEqual([7])
		expect(detail).toBe('published #7')
		expect(comments_on('10')).toStrictEqual([])
	})

	it('names what is missing and the next commands on both issues and in the output', async () => {
		state.withheld = WITHHELD

		const detail = await run_pause_publish.publish_prepared(REQUEST)

		expect(detail).toBe(`withheld: ${WITHHELD}`)

		for (const issue of ['10', '11']) {
			expect(comments_on(issue)).toHaveLength(1)
			expect(comments_on(issue)[0]).toContain(WITHHELD)
			expect(comments_on(issue)[0]).toContain('pnpm josh issue:file --publish 7')
		}

		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('issue:plan 11'))
	})

	it('names the missing epic when no open epic lists the prerequisite', async () => {
		state.epics = []

		await run_pause_publish.publish_prepared(REQUEST)

		expect(comments_on('11')[0]).toContain('no open epic lists it')
		expect(state.published).toStrictEqual([])
	})
})

describe('run_pause_publish.publish_prepared — nothing to publish or already noted', () => {
	it('leaves a prerequisite that is not prepared alone', async () => {
		state.body = 'Body'

		const detail = await run_pause_publish.publish_prepared(REQUEST)

		expect(detail).toBe(run_pause_publish.NOT_PREPARED)
		expect(state.published).toStrictEqual([])
		expect(state.comments.size).toBe(0)
	})

	it('skips a cross-repository prerequisite', async () => {
		const detail = await run_pause_publish.publish_prepared({ issue: '10', prerequisite: 'o/x#3' })

		expect(detail).toBe(run_pause_publish.NOT_PREPARED)
	})

	it('does not post the note twice on a rerun', async () => {
		state.withheld = WITHHELD

		await run_pause_publish.publish_prepared(REQUEST)
		await run_pause_publish.publish_prepared(REQUEST)

		expect(comments_on('10')).toHaveLength(1)
		expect(comments_on('11')).toHaveLength(1)
	})
})
