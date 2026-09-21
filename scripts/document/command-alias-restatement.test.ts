import { ALIASES } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// The command catalog (`docs/josh-command-catalog.md`) is generated from the command map and owns the
// computable columns — command name, synopsis, audience, side effects and the **aliases**. The
// hand-written reference declares its own boundary in its opening line ("auto-generated from the
// command map … aliases …") and must keep to it: it names commands by their canonical form and never
// restates an alias, so the abbreviation lives in exactly one place (joshuafolkken/kit#2258).
const COMMAND_DOC = 'docs/josh-commands.md'

// The forms an alias abbreviation is restated in — read off the ways the document named them before
// this Issue removed them: a code-span invocation (`` `josh rh` ``, headings included), the `alias:`
// label a code comment carried, the `` alias `rp` `` prose clause, and a bare `pnpm josh rh`
// invocation in a fence. Each demands a command-invocation prefix (a leading backtick or `pnpm `) or
// the literal word `alias`, so prose like "reclaim the global josh by removing" — `josh` followed by
// an English word — is not mistaken for a restatement.
function alias_patterns(alias: string): ReadonlyArray<RegExp> {
	const token = alias.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)

	return [
		new RegExp(`\`(?:pnpm )?josh ${token}(?![\\w:-])`, 'u'),
		new RegExp(String.raw`alias:\s*(?:josh )?${token}(?![\w:-])`, 'u'),
		new RegExp(`[Aa]lias \`(?:josh )?${token}\``, 'u'),
		new RegExp(String.raw`pnpm josh ${token}(?![\w:-])`, 'u'),
	]
}

// Matched against the whitespace-collapsed text, not the raw file: the reference wraps prose at 100
// columns, so a restatement can straddle a line break (`; alias` on one line, `` `rev` `` on the
// next) — and a guard that misses exactly the case it exists to catch is worse than none.
function restated_aliases(text: string, aliases: ReadonlyArray<string>): ReadonlyArray<string> {
	return aliases.filter((alias) => alias_patterns(alias).some((pattern) => pattern.test(text)))
}

const ALIAS_KEYS: ReadonlyArray<string> = Object.keys(ALIASES)

describe('the hand-written command reference never restates an alias', () => {
	it('names no alias the catalog already owns', () => {
		const unwrapped = read_unwrapped(COMMAND_DOC)

		expect(restated_aliases(unwrapped, ALIAS_KEYS)).toStrictEqual([])
	})

	// The guard is only worth keeping if it fails on the thing it exists to catch — one case per form.
	it('flags a restatement in each of its forms', () => {
		expect(restated_aliases('run `josh rh` to claim', ALIAS_KEYS)).toStrictEqual(['rh'])
		expect(restated_aliases('the branch diff; alias: josh sys', ALIAS_KEYS)).toStrictEqual(['sys'])
		expect(restated_aliases('into one call; alias `rp`.', ALIAS_KEYS)).toStrictEqual(['rp'])
		expect(restated_aliases('pnpm josh obf   # alias', ALIAS_KEYS)).toStrictEqual(['obf'])
	})

	// The canonical name and English prose that merely follows the word `josh` are not restatements.
	it('accepts the canonical form and leaves ordinary prose alone', () => {
		expect(restated_aliases('run `pnpm josh run:hold` to claim', ALIAS_KEYS)).toStrictEqual([])
		expect(
			restated_aliases('reclaim the global josh by removing a shim', ALIAS_KEYS),
		).toStrictEqual([])
	})
})
