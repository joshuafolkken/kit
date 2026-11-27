import { describe, expect, it, vi } from 'vitest'
import { acceptance_map } from './acceptance-map'
import { acceptance_map_check } from './acceptance-map-check'

// joshuafolkken/kit#9146: the merge refuses a criterion the Issue leaves neither ticked nor marked
// `→ #M`, and a mark whose issue carries no reference to the criterion's identifier.

type FieldRead = { kind: 'read'; text: string | undefined } | { kind: 'missing' }

const body_read_mock = vi.hoisted(() =>
	vi.fn<(issue: string, repo?: string) => Promise<FieldRead>>(),
)

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body_classified: body_read_mock, pr_get_body: vi.fn() },
}))

const ISSUE = '9103'
const TARGET = '9104'
const MET = ['Ticked one', 'Ticked two']
const MOVED = ['Moved one', 'Moved two', 'Moved three', 'Moved four']
const MOVED_IDS = MOVED.map((text) => acceptance_map.criterion_id(text))

function answer(reads: Readonly<Record<string, string>>): void {
	body_read_mock.mockImplementation(async (issue) => {
		const text = reads[issue]

		return text === undefined ? { kind: 'missing' } : { kind: 'read', text }
	})
}

function section(lines: ReadonlyArray<string>): string {
	return ['## 受け入れ条件', '', ...lines].join('\n')
}

function issue_body(mark: string): string {
	return section([
		...MET.map((text) => `- [x] ${text}`),
		...MOVED.map((text) => `- [ ] ${text}${mark}`),
	])
}

function met_row(text: string): string {
	return `- \`${acceptance_map.criterion_id(text)}\` ${text} — 満たした: a test`
}

function map_of(rows: ReadonlyArray<string>): string {
	return [acceptance_map.MAP_HEADING, '', ...rows].join('\n')
}

function pr_body(): string {
	const moved = MOVED_IDS.map((id) => `- \`${id}\` 見送り: #${TARGET} split off`)

	return map_of([...MET.map((text) => met_row(text)), ...moved])
}

function carried(): string {
	return MOVED_IDS.map((id) => `引き継ぎ: #${ISSUE} \`${id}\` split off`).join('\n')
}

describe('acceptance_map_check.body_refusal — the Issue accounts for each criterion', () => {
	it('refuses deferral rows the Issue does not mark, naming each (ac-ddfdb837)', async () => {
		answer({ [ISSUE]: issue_body(''), [TARGET]: carried() })
		const refusal = await acceptance_map_check.body_refusal(ISSUE, pr_body())

		for (const id of MOVED_IDS) expect(refusal).toContain(id)
		expect(refusal).toContain('issue:defer')
	})

	it('passes criteria marked on the Issue and carried by the target (ac-4ae478ae)', async () => {
		answer({ [ISSUE]: issue_body(` → #${TARGET}`), [TARGET]: carried() })

		await expect(acceptance_map_check.body_refusal(ISSUE, pr_body())).resolves.toBeUndefined()
	})

	it('refuses a mark whose target no longer carries the criterion (ac-6d0affff)', async () => {
		answer({ [ISSUE]: issue_body(` → #${TARGET}`), [TARGET]: '## 受け入れ条件\n- [ ] Rewritten' })
		const refusal = await acceptance_map_check.body_refusal(ISSUE, pr_body())

		for (const id of MOVED_IDS) expect(refusal).toContain(`${id}\` → #${TARGET}`)
	})

	it('passes an issue with no acceptance section (ac-50175635)', async () => {
		answer({ [ISSUE]: '## 背景' })

		await expect(acceptance_map_check.body_refusal(ISSUE, '')).resolves.toBeUndefined()
	})

	it.each([
		['マージ後の確認: /verify-ui shows the board', '- [ ] '],
		['A criterion with no checkbox', '- '],
	])('passes an open checkbox the merge cannot tick: %s (ac-9b58f151)', async (text, bullet) => {
		const map = map_of([met_row(text)])

		answer({ [ISSUE]: section([`${bullet}${text}`]) })

		await expect(acceptance_map_check.body_refusal(ISSUE, map)).resolves.toBeUndefined()
	})
})

describe('acceptance_map_check.body_refusal — the draft (pending_present)', () => {
	const draft = { pending_present: true }

	it('passes met and pending rows on open checkboxes (ac-31166520)', async () => {
		const body = section(['- [ ] Met later', '- [ ] Still pending'])
		const map = acceptance_map.skeleton(body) ?? ''

		answer({ [ISSUE]: body })

		await expect(acceptance_map_check.body_refusal(ISSUE, map, draft)).resolves.toBeUndefined()
	})

	it('refuses a deferral row whose criterion is not marked (ac-31166520)', async () => {
		answer({ [ISSUE]: issue_body(''), [TARGET]: carried() })
		const refusal = await acceptance_map_check.body_refusal(ISSUE, pr_body(), draft)

		expect(refusal).toContain(MOVED_IDS[0])
		expect(refusal).not.toContain(acceptance_map.criterion_id(MET[0] ?? ''))
	})
})
