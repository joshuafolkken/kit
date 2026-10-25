import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import { review_brief_paths } from './review-brief-paths'

// joshuafolkken/kit#4941: `josh ship` reuses round 1 once a recorded High's fix moved only where round 2
// reads, so round 2's brief names the High-cited files to read whole.

const ROOT = '/lanes/4941'
const CITED = 'scripts/a.ts'
const BASE = 'fedcba9876543210fedcba9876543210fedcba98'
const TREE = { [CITED]: 'after' }
const ROUND_ONE: FileMapStamp = {
	taken_at: '2026-10-26T01:00:00.000Z',
	files: { [CITED]: 'before' },
	base: BASE,
}
const { HIGH_FIX_LINE } = review_brief_paths

function compose(round: number, high_cited: ReadonlyArray<string>): string {
	return review_brief.compose({
		level: 'medium',
		profile: agent_role_profile.DEFAULT_PROFILES.reviewer,
		round,
		tree: TREE,
		stamps: { gate: undefined, in_flight: undefined, round_one: ROUND_ONE },
		checkout: { root: ROOT, branch: '4941-lane', head: BASE },
		nonce: 'deadbeefcafef00d',
		base: BASE,
		rubric_path: '/pkg/prompts/review-rubric.md',
		high_cited,
	})
}

describe('review_brief_paths.high_fix_lines', () => {
	it('names each High-cited file under the checkout root', () => {
		expect(review_brief_paths.high_fix_lines(ROOT, [CITED])).toStrictEqual([
			`${HIGH_FIX_LINE}\n  ${ROOT}/${CITED}`,
		])
	})

	it('prints no line when no High is recorded', () => {
		expect(review_brief_paths.high_fix_lines(ROOT, [])).toStrictEqual([])
		expect(review_brief_paths.high_fix_lines(ROOT)).toStrictEqual([])
	})
})

describe('review_brief.compose — the High-cited files', () => {
	it('names them on round 2 with absolute paths', () => {
		const brief = compose(2, [CITED])

		expect(brief).toContain(HIGH_FIX_LINE)
		expect(brief).toContain(`  ${ROOT}/${CITED}`)
	})

	it('does not name them on round 1, which reads the whole change', () => {
		expect(compose(1, [CITED])).not.toContain(HIGH_FIX_LINE)
	})

	it('prints no line on round 2 when no High is recorded', () => {
		expect(compose(2, [])).not.toContain(HIGH_FIX_LINE)
	})
})
