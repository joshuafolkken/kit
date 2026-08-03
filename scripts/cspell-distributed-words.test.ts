import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { describe, expect, it } from 'vitest'
import { init_logic } from './init/init-logic'
import { resolve_local_bin } from './local-bin'

// A consumer's `cspell.config.yaml` is generated with `words: []` and a single import of the
// dictionary kit distributes (`cspell/index.yaml`). kit's own root `cspell.config.yaml` is not
// published, so a word that only lives there is invisible to every consumer — and kit's own
// `josh cspell:dot` stays green in both the broken and the fixed state, because it loads the
// root config on top of the distributed one. `--no-config-search` reproduces the consumer's
// view by keeping the root config out of the resolution walk (kit#730).
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CSPELL_BIN = 'cspell'
const DISTRIBUTED_DICTIONARY = path.join('cspell', 'index.yaml')
const CSPELL_FLAGS: ReadonlyArray<string> = [
	'lint',
	'--no-config-search',
	'--config',
	DISTRIBUTED_DICTIONARY,
	'--no-progress',
	'--no-summary',
	'--words-only',
	'--unique',
	'--no-exit-code',
	'--dot',
]

// `josh init` / `josh sync` copy exactly this list into the consumer tree, so reading it back
// from init-logic keeps the guard covering any file added to the distribution later.
const DISTRIBUTED_FILES = init_logic.get_ai_copy_files()

function collect_unknown_words(files: ReadonlyArray<string>): Array<string> {
	const result = execaSync(resolve_local_bin(REPO_ROOT, CSPELL_BIN), [...CSPELL_FLAGS, ...files], {
		cwd: REPO_ROOT,
		reject: false,
	})

	return result.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
}

describe('files distributed by josh init / josh sync', () => {
	// Without this, a renamed or removed source file would turn the spelling assertion below
	// into a check over nothing while still reporting green.
	it('ships every file it copies into a consumer', () => {
		const missing = DISTRIBUTED_FILES.filter((file) => !existsSync(path.join(REPO_ROOT, file)))

		expect(missing).toEqual([])
	})

	// Fails the moment a distributed document gains a term that only kit's private word list
	// knows — exactly the state that broke every consumer on 1.44.0.
	it('spells every word through the distributed dictionary alone', () => {
		expect(collect_unknown_words(DISTRIBUTED_FILES)).toEqual([])
	})
})
