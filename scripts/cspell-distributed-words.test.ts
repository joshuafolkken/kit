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

// `josh init` / `josh sync` write all of these into the consumer tree — verbatim copies, renamed
// copies, and the rendered sonar template — so reading the lists back from init-logic keeps the
// guard covering anything added to the distribution later. The gitignore template is deliberately
// absent: the distributed `ignorePaths` drops `**/.gitignore`, so a consumer never spell-checks
// the file it becomes.
const DISTRIBUTED_FILES: ReadonlyArray<string> = [
	...init_logic.get_ai_copy_files(),
	...init_logic.get_ai_copy_file_mappings().map((mapping) => mapping.src),
	init_logic.get_sonar_template_source(),
]

// The skills are copied whole, so the guard has to walk them rather than name their files — and
// until joshuafolkken/kit#1092 it did neither. `worktrees` and `evals` sat in kit's private list
// while `.claude/skills/workflow-commands/` shipped using them, so kit stayed green and every
// consumer's first `josh sync` failed. Reading the same list `sync` copies from is what keeps a
// skill added later from re-opening the gap.
const DISTRIBUTED_DIRECTORIES: ReadonlyArray<string> = init_logic.get_ai_copy_directories()

// Six times the suite default, which is what a scan measured at ten seconds needs to stay a signal
// about spelling rather than about how busy the machine was.
const SCAN_TIMEOUT_MS = 60_000

// cspell takes a glob for a directory; the existence check above takes the directory itself.
const DISTRIBUTED_GLOBS: ReadonlyArray<string> = DISTRIBUTED_DIRECTORIES.map(
	(directory) => `${directory}/**`,
)

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
		const copied = [...DISTRIBUTED_FILES, ...DISTRIBUTED_DIRECTORIES]
		const missing = copied.filter((entry) => !existsSync(path.join(REPO_ROOT, entry)))

		expect(missing).toEqual([])
	})

	// Fails the moment a distributed document gains a term that only kit's private word list
	// knows — exactly the state that broke every consumer on 1.44.0.
	//
	// **The budget is its own, not the suite's** (joshuafolkken/kit#1246). This one test spawns a
	// whole cspell process over every distributed file and skill directory, and that set grows with
	// the distribution: at the 10-second default it took 10.09s inside `pnpm josh gate`, where three
	// other CPU-heavy checks run beside it, while passing on its own. Timing out there reports a
	// spelling failure that is not one — and it fails on whichever change happens to add the next
	// distributed paragraph, which is the least informative moment possible. Nothing about the
	// assertion is relaxed; only the wall-clock it is allowed to take.
	it(
		'spells every word through the distributed dictionary alone',
		() => {
			expect(collect_unknown_words([...DISTRIBUTED_FILES, ...DISTRIBUTED_GLOBS])).toEqual([])
		},
		SCAN_TIMEOUT_MS,
	)
})
