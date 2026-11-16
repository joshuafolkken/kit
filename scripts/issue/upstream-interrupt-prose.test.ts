import { session_language } from '#scripts/josh/session-language'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { upstream_interrupt_prose } from './upstream-interrupt-prose'

// joshuafolkken/kit#7670: the sentences a person reads follow `JOSH_SESSION_LANG`; the `stash:pop`
// command and the cited names inside them stay as given in either language.

const FINDER = 'joshuafolkken/kit#7670'
const REPO = 'someone/else'
const STASH_COMMAND = '`pnpm josh stash:pop "upstream-interrupt #7670"`'

afterEach(() => {
	vi.unstubAllEnvs()
})

// An empty value resolves as an unset one does (`session-language.ts`).
function prose_in(lang: string): Array<string> {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return [
		upstream_interrupt_prose.resume('upstream-interrupt #7670'),
		upstream_interrupt_prose.stopped(FINDER),
		upstream_interrupt_prose.not_filed(REPO),
	]
}

describe('upstream_interrupt_prose — the sentences follow the session language', () => {
	it.each(['', 'ja'])('writes Japanese when the language is "%s"', (lang) => {
		expect(prose_in(lang)).toStrictEqual([
			`再開: ${STASH_COMMAND}。`,
			`${FINDER} はこの上流の不具合で止まった。作業は stash してある。`,
			`起票していない: \`${REPO}\` は第三者のリポジトリ（Tier C）なので、下の下書きは人が投稿する。`,
		])
	})

	it('writes English when the language is en', () => {
		expect(prose_in('en')).toStrictEqual([
			`Resume with ${STASH_COMMAND}.`,
			`${FINDER} stopped on this upstream defect; its work is stashed.`,
			`Not filed: \`${REPO}\` is third-party (Tier C) — a person posts the draft below.`,
		])
	})
})
