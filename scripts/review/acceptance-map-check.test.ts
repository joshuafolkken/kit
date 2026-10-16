import { describe, expect, it, vi } from 'vitest'
import { acceptance_map } from './acceptance-map'
import { acceptance_map_check } from './acceptance-map-check'

// joshuafolkken/kit#3954. The merge re-reads the issue, reads the pull request body, and asks whether
// each issue a deferral row names exists.

type FieldRead = { kind: 'read'; text: string | undefined } | { kind: 'missing' }

const body_read_mock = vi.hoisted(() =>
	vi.fn<(issue: string, repo?: string) => Promise<FieldRead>>(),
)
const pr_body_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body_classified: body_read_mock, pr_get_body: pr_body_mock },
}))

const ISSUE = '3954'
const BRANCH = '3954-lane'
const SPLIT_OFF = '4000'
const CRITERION = 'The followup refuses an unmapped criterion'
const ISSUE_BODY = `## 受け入れ条件\n\n- [ ] ${CRITERION}`
const DEFERRED_ROW = `- \`${acceptance_map.criterion_id(CRITERION)}\` 見送り: #${SPLIT_OFF} split off`

function answer(reads: Readonly<Record<string, FieldRead>>, pr_body: string): void {
	body_read_mock.mockImplementation(async (issue) => reads[issue] ?? { kind: 'missing' })
	pr_body_mock.mockReset().mockResolvedValue(pr_body)
}

function pr_with(row: string): string {
	return [acceptance_map.MAP_HEADING, '', row].join('\n')
}

describe('acceptance_map_check.refusal', () => {
	it('passes an issue with no acceptance section', async () => {
		answer({ [ISSUE]: { kind: 'read', text: '## 背景' } }, '')

		await expect(acceptance_map_check.refusal(ISSUE, BRANCH)).resolves.toBeUndefined()
	})

	it('refuses when the issue cannot be re-read', async () => {
		answer({}, '')

		await expect(acceptance_map_check.refusal(ISSUE, BRANCH)).resolves.toContain(
			'could not be re-read',
		)
	})

	it('passes a deferral to an issue that exists', async () => {
		answer(
			{ [ISSUE]: { kind: 'read', text: ISSUE_BODY }, [SPLIT_OFF]: { kind: 'read', text: '' } },
			pr_with(DEFERRED_ROW),
		)

		await expect(acceptance_map_check.refusal(ISSUE, BRANCH)).resolves.toBeUndefined()
	})

	it('refuses a deferral to an issue that does not exist, naming it', async () => {
		answer({ [ISSUE]: { kind: 'read', text: ISSUE_BODY } }, pr_with(DEFERRED_ROW))

		await expect(acceptance_map_check.refusal(ISSUE, BRANCH)).resolves.toContain(`#${SPLIT_OFF}`)
	})

	it('asks a given body without reading the pull request', async () => {
		answer({ [ISSUE]: { kind: 'read', text: ISSUE_BODY } }, '')

		await expect(acceptance_map_check.body_refusal(ISSUE, undefined)).resolves.toContain(CRITERION)
		expect(pr_body_mock).not.toHaveBeenCalled()
	})

	it('reads a deferral to another repository there', async () => {
		const row = `- \`${acceptance_map.criterion_id(CRITERION)}\` 見送り: owner/repo#${SPLIT_OFF} split off`

		answer({ [ISSUE]: { kind: 'read', text: ISSUE_BODY } }, pr_with(row))
		await acceptance_map_check.refusal(ISSUE, BRANCH)

		expect(body_read_mock).toHaveBeenCalledWith(SPLIT_OFF, 'owner/repo')
	})
})
