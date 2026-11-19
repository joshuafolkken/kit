import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pause } from './run-pause'

// joshuafolkken/kit#8105: a prepared prerequisite with no recorded plan was waited on unpublished
// (#8030, #8057). The plan check runs ahead of the set-aside: every step is recorded by name, so a
// refusal shows that none ran, and the plan is judged by publication's own predicate.

const PENDING_BODY = 'Body\n\n<!-- josh:publication {"labels":["run:lane"]} -->'

const state = vi.hoisted(() => ({
	body: '',
	labels: [] as Array<string>,
	ran: [] as Array<string>,
	published: [] as Array<number>,
}))

vi.mock('#scripts/run/pause/run-set-aside', () => ({
	run_set_aside: {
		steps_of: (_aside: unknown, inner: ReadonlyArray<[string, () => Promise<string>]>) => [
			['set-aside', async () => 'stashed'],
			...inner,
			['release', async () => 'released'],
		],
		run_steps: async (steps: ReadonlyArray<[string, () => Promise<string>]>) => {
			for (const [name, run] of steps) {
				state.ran.push(name)
				// eslint-disable-next-line no-await-in-loop -- the steps run in order, as the real runner does
				await run()
			}

			return { kind: 'done', done: [] }
		},
	},
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
			labels: state.labels,
			blocked_by: [],
			body: state.body,
		}),
	},
}))

vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { record: async () => 'recorded', listing_epics: async () => [7] },
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

const REQUEST = { issue: '10', prerequisite: '11' }
const PLANNED = 'run:planned'

beforeEach(() => {
	Object.assign(state, { body: PENDING_BODY, labels: [], ran: [], published: [] })
})

describe('run_pause.pause — a prepared prerequisite with no recorded plan', () => {
	it('refuses before any step and names the plan command', async () => {
		const result = await run_pause.pause(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: 'plan', done: [] })
		expect(result.kind === 'failed' && result.reason).toContain(
			'pnpm josh issue:plan 11 --body-file … --planned --no-notify',
		)
		expect(state.ran).toStrictEqual([])
		expect(state.published).toStrictEqual([])
	})

	it('refuses a plan held as `plan:unverified`', async () => {
		state.labels = [PLANNED, 'plan:unverified']

		const result = await run_pause.pause(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: 'plan' })
		expect(state.ran).toStrictEqual([])
	})
})

describe('run_pause.pause — a prerequisite the check lets through', () => {
	it('runs every step and publishes the epic when the plan is recorded', async () => {
		state.labels = [PLANNED]

		const result = await run_pause.pause(REQUEST)

		expect(result.kind).toBe('paused')
		expect(state.ran).toStrictEqual(['set-aside', 'blocked-by', 'publish-prepared', 'release'])
		expect(state.published).toStrictEqual([7])
	})

	it('runs every step for a prerequisite that is not prepared', async () => {
		state.body = 'Body'

		const result = await run_pause.pause(REQUEST)

		expect(result.kind).toBe('paused')
		expect(state.ran).toHaveLength(4)
	})

	it('runs every step for a cross-repository prerequisite', async () => {
		const result = await run_pause.pause({ issue: '10', prerequisite: 'o/x#3' })

		expect(result.kind).toBe('paused')
		expect(state.ran).toHaveLength(4)
	})
})
