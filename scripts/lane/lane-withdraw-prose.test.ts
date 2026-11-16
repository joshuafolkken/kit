import { session_language } from '#scripts/josh/session-language'
import { describe, expect, it, vi } from 'vitest'
import { lane_withdraw_prose, type Withdrawer } from './lane-withdraw-prose'

// joshuafolkken/kit#7668: the withdraw comment's sentences follow the session language, unset reading
// as Japanese; the `- Why:` label and the reason after it do not.

const REASON = 'superseded by #3780'
const WHY = `- Why: ${REASON}`
const EVERY_WITHDRAWER: ReadonlyArray<Withdrawer> = ['person', 'supervisor', 'merge', 'yield']

function lines_of(lang: string, by: Withdrawer, is_closed: boolean): Array<string> {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return lane_withdraw_prose.comment(by, is_closed, REASON).split('\n')
}

describe('lane_withdraw_prose.comment — the session language', () => {
	it.each(['ja', ''])('writes an open issue’s comment in Japanese for %j', (lang) => {
		expect(lines_of(lang, 'person', false)).toStrictEqual([
			'人が `pnpm josh lane:withdraw` で今回のランから取り下げた。',
			'レーンの子を止めてレーンを閉じた。Issue は開いたまま: 今回のランでは再開せず、次のランで再び提示される。',
			WHY,
		])
	})

	it('writes an open issue’s comment in English for en', () => {
		expect(lines_of('en', 'person', false)).toStrictEqual([
			'Withdrawn from the current run by a person with `pnpm josh lane:withdraw`.',
			'Its lane child was stopped and the lane closed. The Issue stays open: this run does not resume it, and the next run offers it again.',
			WHY,
		])
	})

	it('writes a closed issue’s comment in each language', () => {
		expect(lines_of('ja', 'merge', true)).toStrictEqual([
			'Issue がマージなしで閉じられた後に、`pnpm josh run:merge` がレーンを取り下げた。',
			'レーンの子を止めてレーンを閉じたので、レーンを持たず、再開もされない。',
			WHY,
		])
		expect(lines_of('en', 'merge', true)).toStrictEqual([
			'Its lane was withdrawn by `pnpm josh run:merge` after the Issue was closed without a merge.',
			'Its lane child was stopped and the lane closed, so it no longer holds a lane and is not resumed.',
			WHY,
		])
	})

	it('gives a yield its own tail in each language', () => {
		expect(lines_of('ja', 'yield', false)[1]).toContain('実装の編集より前にレーンを閉じた。')
		expect(lines_of('en', 'yield', false)[1]).toContain(
			'The lane closed before any implementation edit.',
		)
	})
})

describe('lane_withdraw_prose.comment — what stays English', () => {
	it.each(EVERY_WITHDRAWER)(
		'ends the %s comment with the same `- Why:` line in both languages',
		(by) => {
			for (const is_closed of [true, false]) {
				expect(lines_of('ja', by, is_closed).at(-1)).toBe(WHY)
				expect(lines_of('en', by, is_closed).at(-1)).toBe(WHY)
			}
		},
	)
})
