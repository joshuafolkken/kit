import { session_language } from '#scripts/josh/session-language'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_merge_prose } from './run-merge-prose'

// joshuafolkken/kit#7699: the prose a person reads follows the session language; the label, the line
// labels, commands and paths stay English.

const WHY = 'the child asked which option to take'
const DIRECTORY = '/lanes/7699'
const JAPANESE_LANGS = ['', 'ja']
const DECISION_MARKS = [
	'`needs-decision`',
	'`pnpm josh run:merge`',
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
