import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepared_prerequisite } from './prepared-prerequisite'

// joshuafolkken/kit#8222: the judgement and the publication `run:pause` and `backlog:triage` share.

const PENDING_BODY = 'Body\n\n<!-- josh:publication {"labels":["run:lane"]} -->'
const PLANNED = 'run:planned'

const state = vi.hoisted(() => ({
	body: '',
	state: 'OPEN',
	labels: [] as Array<string>,
	repo: 'o/r' as string | undefined,
	epics: [] as Array<number>,
	withheld: undefined as string | undefined,
	published: [] as Array<number>,
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { repo_get_name_with_owner: async () => state.repo },
}))
vi.mock('#scripts/epic/epic-live', () => ({
	epic_live: {
		child: async (number: number, repo: string) => ({
			number,
			repo,
			state: state.state,
			labels: state.labels,
			blocked_by: [],
			body: state.body,
		}),
	},
}))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { listing_epics: async () => state.epics },
}))
vi.mock('#scripts/issue/issue-publication', async (import_original) => {
	const { issue_publication }: { issue_publication: object } = await import_original()

	return {
		issue_publication: {
			...issue_publication,
			publish: async (epic: number) => {
				if (state.withheld !== undefined) throw new Error(state.withheld)
				state.published.push(epic)
			},
		},
	}
})

const WORDING = { outcome: 'nothing was written.', rerun: 'rerun this triage' }

beforeEach(() => {
	Object.assign(state, {
		body: PENDING_BODY,
		state: 'OPEN',
		labels: [],
		repo: 'o/r',
		epics: [7],
		withheld: undefined,
		published: [],
	})
})

describe('prepared_prerequisite.refusal', () => {
	it('refuses a prepared prerequisite with no recorded plan, in the caller words', async () => {
		const reason = await prepared_prerequisite.refusal('11', WORDING)

		expect(reason).toContain('Prepared #11 needs its recorded plan: nothing was written.')
		expect(reason).toContain(
			'pnpm josh issue:plan 11 --body-file … --planned --no-notify`, then rerun this triage',
		)
	})

	it('refuses when the read fails', async () => {
		state.repo = undefined

		await expect(prepared_prerequisite.refusal('11', WORDING)).resolves.toContain(
			'Cannot check the plan of #11',
		)
	})

	it.each([
		['a planned', () => (state.labels = [PLANNED])],
		['a closed', () => (state.state = 'CLOSED')],
		['a published', () => (state.body = 'Body')],
	])('passes %s prerequisite', async (_case, arrange) => {
		arrange()

		await expect(prepared_prerequisite.refusal('11', WORDING)).resolves.toBeUndefined()
	})
})

describe('prepared_prerequisite.publish', () => {
	it('publishes the epic listing a planned prepared prerequisite', async () => {
		state.labels = [PLANNED]

		await expect(prepared_prerequisite.publish('11')).resolves.toStrictEqual({
			epic: 7,
			reason: undefined,
		})
		expect(state.published).toStrictEqual([7])
	})

	it('names the missing epic when no open epic lists it', async () => {
		state.epics = []

		await expect(prepared_prerequisite.publish('11')).resolves.toStrictEqual({
			epic: undefined,
			reason: 'no open epic lists it',
		})
	})

	it('names the withholding reason', async () => {
		state.withheld = 'withheld'

		await expect(prepared_prerequisite.publish('11')).resolves.toStrictEqual({
			epic: 7,
			reason: 'withheld',
		})
	})

	it.each([
		['a closed', '11', () => (state.state = 'CLOSED')],
		['a cross-repository', 'o/r#11', () => undefined],
	])('leaves %s prerequisite alone', async (_case, prerequisite, arrange) => {
		arrange()

		await expect(prepared_prerequisite.publish(prerequisite)).resolves.toBe(
			prepared_prerequisite.NOT_PREPARED,
		)
		expect(state.published).toStrictEqual([])
	})
})
