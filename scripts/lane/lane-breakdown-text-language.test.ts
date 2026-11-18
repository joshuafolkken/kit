import { session_language } from '#scripts/josh/session-language'
import { describe, expect, it, vi } from 'vitest'
import { lane_breakdown_text, type Report } from './lane-breakdown-text'

// joshuafolkken/kit#7668: the breakdown comment's heading follows the session language; the stage lines
// under it and the one-line form the investigation's prompt reads stay English.

const MINUTE_MS = 60_000
const ISSUE = 4970
const JA_LEAD = '工程別の正味時間（長い順）、正味 62 分 (`pnpm josh lane:breakdown 4970`):'
const EN_LEAD =
	'Net time by stage, longest first, 62 min of net time (`pnpm josh lane:breakdown 4970`):'
const STAGE_TEXT = 'implement 62.0 min, over budget +53 min ()'
const EXCLUDED_TEXT =
	'waits taken out (park, outage, usage limit, yield, split run, host stop) 0.0 min, of which yield wait 0.0 min, of which host stop (sleep or network down) 0.0 min'

const REPORT: Report = {
	breakdown: {
		stages: [{ name: 'implement', ms: 62 * MINUTE_MS }],
		excluded_ms: 0,
		slept_ms: 0,
		yield_ms: 0,
		waits: [],
		implement: [],
		pre_detach: [],
		ship: [],
	},
	detail: { kinds: [], background: 0, untimed: new Map() },
}

describe('lane_breakdown_text.comment — the session language', () => {
	it.each([
		['ja', JA_LEAD],
		['', JA_LEAD],
		['en', EN_LEAD],
	])('heads the comment in %j and keeps the stage lines English', (lang, lead) => {
		vi.stubEnv(session_language.ENV_KEY, lang)

		expect(lane_breakdown_text.comment(ISSUE, 62, REPORT).split('\n')).toStrictEqual([
			lead,
			'',
			`- ${STAGE_TEXT}`,
			`- ${EXCLUDED_TEXT}`,
		])
	})

	it.each(['ja', 'en'])('keeps the one-line form English in %j', (lang) => {
		vi.stubEnv(session_language.ENV_KEY, lang)

		expect(lane_breakdown_text.line(REPORT)).toBe(
			`Net time by stage, longest first: ${STAGE_TEXT}; ${EXCLUDED_TEXT}.`,
		)
	})
})
