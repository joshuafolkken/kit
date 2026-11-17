import { session_language } from '#scripts/josh/session-language'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BacklogIssue } from './epic-bundle'
import { epic_bundle_recommend } from './epic-bundle-recommend'

const REPO = 'joshuafolkken/kit'
const OLDER_EPIC = 880
const NEWER_EPIC = 893
const SUBJECT_NUMBER = 894
const DATE = '2026-11-02'

function member(number: number, epic: number): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], epic }
}

describe('epic_bundle_recommend.recommend_epic', () => {
	it('recommends the epic tracking the most related issues', () => {
		const members = [member(1, OLDER_EPIC), member(2, NEWER_EPIC), member(3, NEWER_EPIC)]

		expect(epic_bundle_recommend.recommend_epic([OLDER_EPIC, NEWER_EPIC], members)).toBe(NEWER_EPIC)
	})

	it('recommends the older epic on a tie', () => {
		const members = [member(1, NEWER_EPIC), member(2, OLDER_EPIC)]

		expect(epic_bundle_recommend.recommend_epic([NEWER_EPIC, OLDER_EPIC], members)).toBe(OLDER_EPIC)
	})

	it('recommends nothing when there are no epics', () => {
		expect(epic_bundle_recommend.recommend_epic([], [])).toBeUndefined()
	})
})

function record_of(): string {
	return epic_bundle_recommend.placement_record(
		{
			subject: SUBJECT_NUMBER,
			epic: NEWER_EPIC,
			epics: [OLDER_EPIC, NEWER_EPIC],
			members: [member(1, OLDER_EPIC), member(2, NEWER_EPIC), member(3, NEWER_EPIC)],
		},
		DATE,
	)
}

describe('epic_bundle_recommend.placement_record', () => {
	const PREFIX = 'Auto-decided (2026-11-02, `epic:bundle --apply`): placed #894 in #893 over #880'

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('records the epic taken, the ones rejected, why and the date in English under en', () => {
		vi.stubEnv(session_language.ENV_KEY, 'en')

		expect(record_of()).toBe(
			`${PREFIX} because it tracks the most related issues (#880: 1, #893: 2); a tie goes to the older epic.`,
		)
	})

	// The prefix is what `run-cut-digest.ts` matches on, so only the reason changes (ac-8cca0653).
	it.each(['ja', ''])(
		'writes the reason in Japanese for the session language %j, keeping the prefix (ac-bc8ebf54)',
		(lang) => {
			vi.stubEnv(session_language.ENV_KEY, lang)

			expect(record_of()).toBe(
				`${PREFIX} — 関連する Issue を最も多く追っているため（#880: 1, #893: 2）。同数なら古い epic を選ぶ。`,
			)
		},
	)
})
