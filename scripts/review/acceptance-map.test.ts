import { describe, expect, it } from 'vitest'
import { acceptance_map } from './acceptance-map'

// joshuafolkken/kit#3954. Each acceptance criterion the Issue carries at the merge needs a row in the
// pull request body — met with evidence, or deferred to a split-off issue — matched by an identifier
// built from the criterion's text.

const FIRST = 'The followup refuses an unmapped criterion'
const SECOND = 'An issue with no acceptance section passes'
const SPLIT_OFF = 'joshuafolkken/kit#4000'
const STALE_ID = 'ac-00000000'
const ADDED = 'A criterion added during the review is refused'
const EVIDENCE = 'acceptance-map.test.ts `refuses a missing row`'

function issue_with(criteria: ReadonlyArray<string>): string {
	return [
		'## 背景',
		'',
		'text',
		'',
		'## 受け入れ条件',
		'',
		...criteria.map((text) => `- [ ] ${text}`),
	].join('\n')
}

function id(text: string): string {
	return acceptance_map.criterion_id(text)
}

function pr_with(rows: ReadonlyArray<string>): string {
	return ['closes #3954', '', acceptance_map.MAP_HEADING, '', ...rows].join('\n')
}

function met(text: string): string {
	return `- \`${id(text)}\` ${text} — 満たした: ${EVIDENCE}`
}

function compare(issue: string, pr: string): ReturnType<typeof acceptance_map.compare> {
	return acceptance_map.compare(acceptance_map.criteria_of(issue), acceptance_map.rows_of(pr))
}

describe('acceptance_map.criteria_of', () => {
	it('reads each top-level item of the acceptance section, checkbox stripped', () => {
		const criteria = acceptance_map.criteria_of(issue_with([FIRST, SECOND]))

		expect(criteria.map((criterion) => criterion.text)).toEqual([FIRST, SECOND])
	})

	it('reads the English heading too, and ignores nested items', () => {
		const body = ['## Acceptance criteria', '', `- ${FIRST}`, '  - detail'].join('\n')

		expect(acceptance_map.criteria_of(body)).toEqual([{ id: id(FIRST), text: FIRST }])
	})

	it('ignores a list item inside a code fence', () => {
		const body = ['## 受け入れ条件', '', `- ${FIRST}`, '```md', `- ${SECOND}`, '```'].join('\n')

		expect(acceptance_map.criteria_of(body)).toEqual([{ id: id(FIRST), text: FIRST }])
	})

	it('reads nothing from an issue with no acceptance section', () => {
		expect(acceptance_map.criteria_of('## 背景\n\n- not a criterion')).toEqual([])
	})

	it('reads a criterion wrapped onto a continuation line as one criterion', () => {
		const body = ['## 受け入れ条件', '', '- [ ] The followup', '  refuses it', `- ${SECOND}`].join(
			'\n',
		)

		expect(acceptance_map.criteria_of(body).map((criterion) => criterion.text)).toEqual([
			'The followup refuses it',
			SECOND,
		])
	})

	it('changes the identifier when only the continuation line is reworded', () => {
		const before = acceptance_map.criteria_of('## 受け入れ条件\n\n- The followup\n  refuses it')
		const after = acceptance_map.criteria_of('## 受け入れ条件\n\n- The followup\n  passes it')

		expect(after[0]?.id).not.toBe(before[0]?.id)
	})

	it('gives a ticked criterion the identifier of the open one', () => {
		const ticked = acceptance_map.criteria_of(`## 受け入れ条件\n\n- [x] ${FIRST}`)

		expect(ticked[0]?.id).toBe(id(FIRST))
	})
})

describe('acceptance_map.compare', () => {
	it('passes when every criterion has a met row', () => {
		const result = compare(issue_with([FIRST, SECOND]), pr_with([met(FIRST), met(SECOND)]))

		expect(result).toEqual({ missing: [], deferrals: [], stale: [] })
	})

	it('names a criterion with no row', () => {
		const result = compare(issue_with([FIRST, SECOND]), pr_with([met(FIRST)]))

		expect(result.missing).toEqual([{ id: id(SECOND), text: SECOND }])
	})

	it('refuses a criterion added after the body was written', () => {
		const result = compare(issue_with([FIRST, ADDED]), pr_with([met(FIRST)]))

		expect(result.missing.map((criterion) => criterion.text)).toEqual([ADDED])
	})

	it('refuses a reworded criterion and reports its old row as stale', () => {
		const reworded = `${FIRST} by name`
		const result = compare(issue_with([reworded]), pr_with([met(FIRST)]))

		expect(result).toEqual({
			missing: [{ id: id(reworded), text: reworded }],
			deferrals: [],
			stale: [id(FIRST)],
		})
	})
})

describe('acceptance_map.compare — row shapes', () => {
	it('treats a pending skeleton row as no row', () => {
		const skeleton = acceptance_map.skeleton(issue_with([FIRST])) ?? ''

		expect(compare(issue_with([FIRST]), `closes #1\n\n${skeleton}`).missing).toHaveLength(1)
	})

	it('treats a pending row as no row when its criterion quotes a met status', () => {
		const quoting = 'Each row reads `- <id> 満たした: <evidence>`'
		const skeleton = acceptance_map.skeleton(issue_with([quoting])) ?? ''

		expect(compare(issue_with([quoting]), `closes #1\n\n${skeleton}`).missing).toHaveLength(1)
	})

	it('treats a met row with no evidence as no row', () => {
		const result = compare(issue_with([FIRST]), pr_with([`- \`${id(FIRST)}\` 満たした:`]))

		expect(result.missing).toHaveLength(1)
	})

	it('reads the status after a criterion that quotes the row format', () => {
		const quoting = '各行は「満たした: 根拠」か「見送り: 切り出した Issue」'
		const result = compare(issue_with([quoting]), pr_with([met(quoting)]))

		expect(result).toEqual({ missing: [], deferrals: [], stale: [] })
	})
})

describe('acceptance_map.compare — deferrals', () => {
	it('maps a criterion deferred to a named issue and returns the issue to check', () => {
		const row = `- \`${id(SECOND)}\` 見送り: ${SPLIT_OFF} split off`
		const result = compare(issue_with([FIRST, SECOND]), pr_with([met(FIRST), row]))

		expect(result).toEqual({
			missing: [],
			deferrals: [{ id: id(SECOND), issue: SPLIT_OFF }],
			stale: [],
		})
	})

	it('treats a deferral with no reason as no row', () => {
		const result = compare(issue_with([FIRST]), pr_with([`- \`${id(FIRST)}\` 見送り: #4000`]))

		expect(result.missing).toHaveLength(1)
	})
})

describe('acceptance_map.skeleton', () => {
	it('writes one pending row per criterion under the table heading', () => {
		expect(acceptance_map.skeleton(issue_with([FIRST]))).toBe(
			[acceptance_map.MAP_HEADING, '', `- \`${id(FIRST)}\` ${FIRST} — 未記入`].join('\n'),
		)
	})

	it('writes nothing for an issue with no criteria', () => {
		expect(acceptance_map.skeleton('## 背景')).toBeUndefined()
	})
})

describe('acceptance_map.refusal_message', () => {
	it('names the missing criterion, the absent deferral and the stale row', () => {
		const message = acceptance_map.refusal_message(
			'3954',
			{ missing: [{ id: id(FIRST), text: FIRST }], deferrals: [], stale: [STALE_ID] },
			['- `ac-11111111` names #9999999'],
		)

		expect(message).toContain(FIRST)
		expect(message).toContain('#9999999')
		expect(message).toContain(STALE_ID)
	})
})
