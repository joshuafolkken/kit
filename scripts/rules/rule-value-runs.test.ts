import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { piped_verification } from './piped-verification'
import { rule_value_cache } from './rule-value-cache'
import { rule_value_cli } from './rule-value-cli'
import { rule_value_fixture } from './rule-value-fixture'
import { rule_value_runs } from './rule-value-runs'

// joshuafolkken/kit#7134: a run whose files have not moved contributes the counts it was read for
// last time, and the table drawn from them is the one a full read draws.

const make_directory = temporary_directory('suite')
const RUN_ONE = 'run1'
const RUN_TWO = 'run2'
const MODULE = 'module.js'

const REFUSAL = rule_value_fixture.answered_call(
	'pnpm josh gate | head -5',
	1,
	piped_verification.PIPED_VERIFICATION_REASON,
)

// Two runs, the first a session and its delegated unit.
const CORPUS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
	[
		RUN_ONE,
		[
			rule_value_fixture.session('gh api repos/o/r/issues/12/comments'),
			rule_value_fixture.session('gh api repos/o/r/issues/12', 'git push --force origin main'),
		],
	],
	[RUN_TWO, [REFUSAL]],
]

interface Corpus {
	directory: string
	runs: Map<string, Array<SessionFile>>
}

function session_file(file: string, session_id: string): SessionFile {
	return { session_id, path: file, modified_ms: 0, is_delegated: false, depth: 0 }
}

function written_corpus(): Corpus {
	const directory = make_directory('rule-value-runs-test-')
	const runs = new Map<string, Array<SessionFile>>()

	for (const [owner, texts] of CORPUS) {
		const files = texts.map((text, index) => {
			const file = path.join(directory, `${owner}-${index.toString()}.jsonl`)

			writeFileSync(file, text)

			return session_file(file, owner)
		})

		runs.set(owner, files)
	}

	return { directory, runs }
}

// What the full read of every file draws, the reference each reuse is held to.
function full_read(
	runs: Map<string, Array<SessionFile>>,
): ReturnType<typeof rule_value_cli.render_parts> {
	const texts = [...runs.values()].map((files) =>
		files.map((file) => cost_transcript.read_optional(file) ?? ''),
	)

	return rule_value_cli.render_parts(texts)
}

function module_file(directory: string, code: string): string {
	const file = path.join(directory, MODULE)

	writeFileSync(file, code)

	return file
}

// The reading through the store at `directory`, saved, with the files it read counted.
function stored_reading(
	corpus: Corpus,
	code = 'code',
): { parts: ReturnType<typeof rule_value_cli.render_parts>; read: number } {
	const reader = vi.spyOn(cost_transcript, 'read_optional')
	const store = rule_value_runs.open(corpus.directory, module_file(corpus.directory, code))

	if (store === undefined) throw new Error('no store outside a lane')

	const parts = rule_value_cli.render_summaries(rule_value_runs.summaries_of(corpus.runs, store))

	const read = reader.mock.calls.length

	store.save()
	reader.mockRestore()

	return { parts, read }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('rule_value_runs.summaries_of — the table equals a full read', () => {
	it('draws the full read with no store', () => {
		const { runs } = written_corpus()
		const summaries = rule_value_runs.summaries_of(runs, stamped_memo.create())

		expect(rule_value_cli.render_summaries(summaries)).toStrictEqual(full_read(runs))
	})

	it('draws it from the saved counts alone when no file moved', () => {
		const corpus = written_corpus()

		stored_reading(corpus)

		const { parts, read } = stored_reading(corpus)

		expect(read).toBe(0)
		expect(parts).toStrictEqual(full_read(corpus.runs))
	})

	it('reads again only the run whose file moved, and draws the new full read', () => {
		const corpus = written_corpus()
		const [moved] = corpus.runs.get(RUN_TWO) ?? []

		stored_reading(corpus)
		appendFileSync(moved?.path ?? '', `\n${REFUSAL}`)

		const { parts, read } = stored_reading(corpus)

		expect(read).toBe(1)
		expect(parts).toStrictEqual(full_read(corpus.runs))
	})
})

describe('rule_value_runs.open — what invalidates the saved counts', () => {
	it('reads every run again once the measuring code changed', () => {
		const corpus = written_corpus()

		stored_reading(corpus, 'before')

		expect(stored_reading(corpus, 'after').read).toBe(3)
	})

	it('versions by the measuring code', () => {
		const directory = make_directory('rule-value-runs-version-')
		const before = rule_value_runs.version_of(module_file(directory, 'before'))

		expect(rule_value_runs.version_of(module_file(directory, 'after'))).not.toBe(before)
	})

	it('opens no store in a lane, whose transcripts are not the whole repository', () => {
		vi.spyOn(rule_value_cache, 'is_linked_work_tree').mockReturnValue(true)

		expect(rule_value_runs.open(make_directory('rule-value-runs-lane-'), MODULE)).toBeUndefined()
	})
})
