import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import type { EpicChild } from './epic-graph'
import { epic_triage } from './epic-triage'

// The triage gate (joshuafolkken/kit#2779): an issue is judged when it carries `run:solo` or
// `run:lane`, whatever their casing.

const REPO = 'joshuafolkken/kit'
const FIRST = 31
const SECOND = 32
const THIRD = 33

function child(number: number, labels: ReadonlyArray<string> = []): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: [] }
}

describe('epic_triage.is_triaged', () => {
	it('reads either label as judged, ignoring case', () => {
		expect(epic_triage.is_triaged(child(FIRST, [RUN_SOLO_LABEL]))).toBe(true)
		expect(epic_triage.is_triaged(child(FIRST, [RUN_LANE_LABEL]))).toBe(true)
		expect(epic_triage.is_triaged(child(FIRST, ['Run:Lane']))).toBe(true)
		expect(epic_triage.is_triaged(child(FIRST, ['RUN:SOLO']))).toBe(true)
	})

	it('reads neither label as untriaged', () => {
		expect(epic_triage.is_triaged(child(FIRST, ['auto-ok']))).toBe(false)
	})
})

describe('epic_triage.untriaged', () => {
	it('keeps only the children nobody has judged, in their order', () => {
		const children = [child(FIRST), child(SECOND, [RUN_LANE_LABEL]), child(THIRD)]

		expect(epic_triage.untriaged(children).map((entry) => entry.number)).toStrictEqual([
			FIRST,
			THIRD,
		])
	})
})

describe('epic_triage.message', () => {
	it('names every untriaged number and both labels', () => {
		const text = epic_triage.message([child(FIRST), child(THIRD)], REPO)

		expect(text).toContain(`issues/${String(FIRST)}`)
		expect(text).toContain(`issues/${String(THIRD)}`)
		expect(text).toContain(RUN_SOLO_LABEL)
		expect(text).toContain(RUN_LANE_LABEL)
	})
})
