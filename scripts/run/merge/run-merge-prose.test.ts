import { issue_outcome } from '#scripts/issue/issue-outcome'
import { session_language } from '#scripts/josh/session-language'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_merge_prose, type ParkReason } from './run-merge-prose'

// joshuafolkken/kit#7699: the prose a person reads follows the session language; the label, the line
// labels, commands and paths stay English.

const WHY = 'the child asked which option to take'
const DIRECTORY = '/lanes/7699'
const JAPANESE_LANGS = ['', 'ja']
const MERGE_COMMAND = '`pnpm josh run:merge`'
const NEEDS_DECISION = 'needs-decision'
const DECISION_MARKS = [
	`\`${NEEDS_DECISION}\``,
	MERGE_COMMAND,
	`- Decision: ${WHY}`,
	'- Consecutive failures: ',
	'- Next: ',
]
const JAPANESE_DECISION = ['子があなたの回答を待っている', '外すと再開する']
const ENGLISH_DECISION = ['the child waits for your answer', 'remove `needs-decision` to resume']
const JAPANESE_KEPT = '分割でこの Issue のレーンを開けたままにした'
const ENGLISH_KEPT = "The split left this issue's lane open"
const IN_JAPANESE = 'writes the prose in Japanese for %j (ac-bc8ebf54)'
const IN_ENGLISH = 'writes the prose in English for en (ac-bc8ebf54)'

function decision_in(lang: string): string {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return run_merge_prose.decision_comment(WHY)
}

function kept_in(lang: string): string {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return run_merge_prose.kept_lane_comment(DIRECTORY)
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_merge_prose.decision_comment — the needs-decision park comment', () => {
	it.each(JAPANESE_LANGS)(IN_JAPANESE, (lang) => {
		const comment = decision_in(lang)

		for (const mark of JAPANESE_DECISION) expect(comment).toContain(mark)
		for (const mark of ENGLISH_DECISION) expect(comment).not.toContain(mark)
	})

	it(IN_ENGLISH, () => {
		const comment = decision_in('en')

		for (const mark of ENGLISH_DECISION) expect(comment).toContain(mark)
		for (const mark of JAPANESE_DECISION) expect(comment).not.toContain(mark)
	})

	it.each(['ja', 'en'])('keeps the label and line labels for %s (ac-9c488e11)', (lang) => {
		const comment = decision_in(lang)

		for (const mark of DECISION_MARKS) expect(comment).toContain(mark)
	})
})

// joshuafolkken/kit#7698: the wait, park and progress comments — prose in the session language, the
// labels, line labels and commands unchanged.
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-09-30T00:00:00.000Z',
	merged: 4,
	filed: 0,
	cuts: 0,
	failures: 2,
	outages: 1,
}
const WAITS = ['#3501', 'not before 2026-10-24T23:29Z']
const CAUSE = 'the session ended unfinished.'
const REASON: ParkReason = { child: '2761', cause: CAUSE, carry: CARRY, output: 'lane.jsonl' }
const KEEPS_MARKS = 'keeps the labels and line labels for %s (ac-ecfff8c9)'
const BOTH_LANGS = ['ja', 'en']

function waiting_in(lang: string): string {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return run_merge_prose.waiting_comment(WAITS)
}

function park_in(lang: string, over: Partial<ParkReason> = {}): string {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return run_merge_prose.park_comment({ ...REASON, ...over })
}

function counters_in(lang: string): string {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return run_merge_prose.counters_comment(CARRY)
}

describe('run_merge_prose.waiting_comment — the release to wait', () => {
	it.each(JAPANESE_LANGS)(IN_JAPANESE, (lang) => {
		const comment = waiting_in(lang)

		expect(comment).toContain('park ではなく、失敗にも数えない')
		expect(comment).toContain('次を待ったまま未完で終わった: #3501, not before 2026-10-24T23:29Z。')
		expect(comment).not.toContain('not counted as a failure')
	})

	// joshuafolkken/kit#4076: a release to wait names what the child waits on, a start date included.
	it(IN_ENGLISH, () => {
		const comment = waiting_in('en')

		expect(comment).toContain('not parked, and not counted as a failure')
		expect(comment).toContain('waits on: #3501, not before 2026-10-24T23:29Z.')
		expect(comment).toContain('its sample condition is met')
		expect(comment).not.toContain(NEEDS_DECISION)
	})

	it.each(BOTH_LANGS)(KEEPS_MARKS, (lang) => {
		const comment = waiting_in(lang)

		for (const mark of [MERGE_COMMAND, '`backlogrun`', '\n- Why: ', '\n- Next: ']) {
			expect(comment).toContain(mark)
		}
	})
})

// joshuafolkken/kit#2769: a park the driver makes is explained on the issue — why, what was read, and
// what a person does next.
describe('run_merge_prose.park_comment — the run:stalled park', () => {
	it.each(JAPANESE_LANGS)(IN_JAPANESE, (lang) => {
		const comment = park_in(lang)

		expect(comment).toContain('機械的な失敗で、判断することはない')
		expect(comment).toContain('マージ済みのプルリクエストの `closes #N` にも挙がっておらず')
		expect(comment).toContain(
			'- Consecutive failures: 2 / 3（3 回連続するごとに `main` を確かめる）。',
		)
		expect(comment).toContain('子のトランスクリプト（`lane.jsonl`）を読み、原因を直してから')
		expect(comment).not.toContain('mechanical failure')
	})

	it(IN_ENGLISH, () => {
		const comment = park_in('en')

		expect(comment).toContain('a mechanical failure, with no decision to make')
		expect(comment).toContain('no merged pull request')
		expect(comment).toContain('- Consecutive failures: 2 of 3 (every 3 in a row checks `main`).')
		expect(comment).toContain('- Next: read the child’s transcript (`lane.jsonl`), fix the cause')
		expect(comment).not.toContain(NEEDS_DECISION)
	})

	it.each(BOTH_LANGS)(KEEPS_MARKS, (lang) => {
		const comment = park_in(lang)
		const marks = [
			'`run:stalled`',
			`\n- Why: ${CAUSE}\n`,
			'\n- Read: ',
			'\n- Next: ',
			'`fullrun #2761`',
		]

		for (const mark of marks) expect(comment).toContain(mark)
	})
})

describe('run_merge_prose.park_comment — the streak and the recovery step', () => {
	it.each([
		['ja', '記録なし（carry 記録が無い）。'],
		['en', 'not recorded (no carry record).'],
	])('says the streak was not recorded with no carry record for %s', (lang, line) => {
		expect(park_in(lang, { carry: undefined })).toContain(`- Consecutive failures: ${line}`)
	})

	it.each([
		[
			'ja',
			'次の手順で再開する: repair the stale hand-off cut record with `pnpm josh run:cut --end`',
		],
		['en', 'repair the stale hand-off cut record with `pnpm josh run:cut --end`'],
	])('requires record repair before retry for %s (ac-438a3cb5)', (lang, step) => {
		const comment = park_in(lang, { cause: run_stalled.STALE_HANDOFF.why, output: undefined })

		expect(comment).toContain(`- Why: ${run_stalled.STALE_HANDOFF.why}`)
		expect(comment).toContain(step)
		expect(comment).toContain('(retry alone does not clear it), then use')
	})

	it.each(['ja', 'en'])('marks the first action for the board under %j (#7852)', (lang) => {
		const comment = park_in(lang, { cause: run_stalled.STALE_HANDOFF.why })

		expect(issue_outcome.next_of(comment)).toBe('pnpm josh run:cut --end')
		expect(comment).toContain('- Next: ')
	})
})

describe('run_merge_prose.counters_comment — the run progress', () => {
	it.each(JAPANESE_LANGS)(IN_JAPANESE, (lang) => {
		expect(counters_in(lang)).toMatch(/^ランの進み具合（carry 記録から生成）:\n/u)
	})

	it(IN_ENGLISH, () => {
		expect(counters_in('en')).toMatch(/^Run progress \(generated from the carry record\):\n/u)
	})

	it.each(BOTH_LANGS)(KEEPS_MARKS, (lang) => {
		const comment = counters_in(lang)

		for (const line of ['- merged: 4', '- consecutive failures: 2', '- consecutive outages: 1']) {
			expect(comment).toContain(line)
		}
	})
})

describe('run_merge_prose.kept_lane_comment — the kept split lane comment', () => {
	it.each(JAPANESE_LANGS)(IN_JAPANESE, (lang) => {
		expect(kept_in(lang)).toBe(
			`${JAPANESE_KEPT}: コミット、未コミットの変更、または動いているプロセスがまだある — ${DIRECTORY}`,
		)
	})

	it(IN_ENGLISH, () => {
		expect(kept_in('en')).toBe(
			`${ENGLISH_KEPT}: it still holds a commit, an uncommitted change or a live process — ${DIRECTORY}`,
		)
	})
})
