import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_triage_cli } from './backlog-triage-cli'

// joshuafolkken/kit#8222, at #8158's grain: the parent ran `backlog:triage --apply 8158 --blocked-by 8178`
// on a split child filed prepared with no plan, so #8178 never published and #8158 waited on it unseen.
// The CLI runs whole here; only the GitHub reads and writes beneath it are stand-ins.

const PENDING_BODY = 'Body\n\n<!-- josh:publication {"labels":["run:lane"]} -->'

const state = vi.hoisted(() => ({
	labels: [] as Array<string>,
	published: [] as Array<number>,
	writes: [] as Array<string>,
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		repo_get_name_with_owner: async () => 'o/r',
		issue_comment: async (issue: string) => {
			state.writes.push(`comment ${issue}`)

			return ''
		},
		issue_apply_label: async (issue: string, label: string) => {
			state.writes.push(`label ${issue} ${label}`)

			return { is_applied: true }
		},
	},
}))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_clear_label: async (issue: string) => {
			state.writes.push(`clear ${issue}`)

			return true
		},
	},
}))
vi.mock('#scripts/run/park/run-park', () => ({
	run_park: {
		clear: (issue: string) => {
			state.writes.push(`park ${issue}`)
		},
	},
}))
vi.mock('#scripts/epic/epic-live', () => ({
	epic_live: {
		child: async (number: number, repo: string) => ({
			number,
			repo,
			state: 'OPEN',
			labels: state.labels,
			blocked_by: [],
			body: PENDING_BODY,
		}),
	},
}))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: {
		listing_epics: async () => [8177],
		record: async ({ issue, prerequisite }: { issue: string; prerequisite: string }) => {
			state.writes.push(`blocked-by ${issue} ${prerequisite}`)

			return 'recorded'
		},
	},
}))
vi.mock('#scripts/issue/issue-publication', async (import_original) => {
	const { issue_publication }: { issue_publication: object } = await import_original()

	return {
		issue_publication: {
			...issue_publication,
			publish: async (epic: number) => {
				state.published.push(epic)
			},
		},
	}
})

const ARGV = [
	'--apply',
	'8158',
	'--blocked-by',
	'8178',
	'--reason',
	'split into #8178, #8179',
	'--clear',
]
const DIRECTORY = '/lane/8158'
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

beforeEach(() => {
	Object.assign(state, { labels: [], published: [], writes: [] })
	error.mockClear()
	info.mockClear()
})

describe('josh backlog:triage --blocked-by — a prepared blocker', () => {
	it('refuses an unplanned prepared blocker, writing nothing and naming issue:plan', async () => {
		await expect(backlog_triage_cli.run(ARGV, DIRECTORY)).resolves.toBe(FAILURE_EXIT_CODE)

		expect(state.writes).toStrictEqual([])
		expect(state.published).toStrictEqual([])
		expect(error.mock.calls.join('\n')).toContain('pnpm josh issue:plan 8178')
	})

	it('records the wait, then publishes the epic listing a planned prepared blocker', async () => {
		state.labels = ['run:planned']

		await expect(backlog_triage_cli.run(ARGV, DIRECTORY)).resolves.toBe(SUCCESS_EXIT_CODE)

		expect(state.writes).toContain('blocked-by 8158 8178')
		expect(state.published).toStrictEqual([8177])
		expect(info.mock.calls.join('\n')).toContain('published [#8177]')
	})
})
