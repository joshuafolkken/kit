import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { import_closure } from '#scripts/lib/import-closure'
import { file_reader } from '#scripts/lib/read-file'
import { stamped_memo, type StampedMemo } from '#scripts/lib/stamped-memo'
import { stamped_store, type StampedStore } from '#scripts/lib/stamped-store'
import { z } from 'zod'
import { delivered_rules } from './delivered-rules'
import {
	piped_verification_shapes,
	type RefusalShape,
	type ShapeCounts,
} from './piped-verification-shapes'
import { rule_rephrase, type RephraseCounts } from './rule-rephrase'
import { rule_value, type RuleReading, type RuleState } from './rule-value'
import { rule_value_cache } from './rule-value-cache'

// `josh rule:value` read run by run, each run's counts kept between measurements
// (joshuafolkken/kit#7134).
//
// **A run adds to the reading on its own**: its rule states, its `piped-verification` refusal shapes
// and its rephrased guards are summed into the totals and never read beside another run. So a run
// whose files have not changed since the last measurement contributes the counts it contributed
// then, and only a run whose files moved is read again. The table equals the one a full read draws.

const STORE_FILE = 'rule-value-runs.json'
const HASH = 'sha256'
const LINE = '\n'
const PAIR = '='

// `states` holds only the credited ones (`rule_value.is_credited`): most rules never reach a run, and
// their blank states would make up nearly all of the store.
interface RunSummary {
	is_read: boolean
	states: Array<[string, RuleState]>
	shapes: Array<[RefusalShape, number]>
	rephrased: Array<[string, number]>
}

// A run with no readable text — not a measurement target, so not counted in `runs`.
const UNREAD: RunSummary = { is_read: false, states: [], shapes: [], rephrased: [] }

const state_schema = z.object({
	is_kept: z.boolean(),
	is_reached: z.boolean(),
	is_triggered: z.boolean(),
	is_refused: z.boolean(),
	is_rewritten: z.boolean(),
})

const state_entry = z.tuple([z.string(), state_schema])
const shape_entry = z.tuple([z.enum(piped_verification_shapes.SHAPE), z.number()])
const count_entry = z.tuple([z.string(), z.number()])

const summary_schema = z.object({
	is_read: z.boolean(),
	states: z.array(state_entry),
	shapes: z.array(shape_entry),
	rephrased: z.array(count_entry),
})

interface Tally {
	runs: number
	readings: ReadonlyArray<RuleReading>
	shapes: ShapeCounts
	rephrased: RephraseCounts
}

function summarize(texts: ReadonlyArray<string>): RunSummary {
	if (texts.length === 0) return UNREAD

	const shapes: ShapeCounts = new Map()
	const rephrased: RephraseCounts = new Map()

	for (const text of texts) piped_verification_shapes.count(text, shapes)
	rule_rephrase.count_run(texts, rephrased)

	const states = [...rule_value.read_run(texts)].filter(([, state]) =>
		rule_value.is_credited(state),
	)

	return { is_read: true, states, shapes: [...shapes], rephrased: [...rephrased] }
}

function readable_texts(files: ReadonlyArray<SessionFile>): Array<string> {
	return files
		.map((file) => cost_transcript.read_optional(file))
		.filter((text): text is string => text !== undefined)
}

// Every file of the run by path, with what changes when it is appended to, rewritten or replaced.
function run_stamp(files: ReadonlyArray<SessionFile>): string {
	return files
		.map((file) => file.path)
		.toSorted((left, right) => left.localeCompare(right))
		.map((file) => `${file}${PAIR}${stamped_memo.file_stamp(file)}`)
		.join(LINE)
}

// **One run read at a time**, and only a run whose stamp moved: its text is released before the next
// is read, so the peak is the largest run rather than the corpus. A run gone from `runs` is forgotten.
function summaries_of(
	runs: ReadonlyMap<string, ReadonlyArray<SessionFile>>,
	memo: StampedMemo<RunSummary>,
): Array<RunSummary> {
	memo.keep(new Set(runs.keys()))

	return [...runs].map(([owner, files]) =>
		memo.of(owner, run_stamp(files), () => summarize(readable_texts(files))),
	)
}

function add<Key>(counts: Map<Key, number>, entries: ReadonlyArray<[Key, number]>): void {
	for (const [key, count] of entries) counts.set(key, (counts.get(key) ?? 0) + count)
}

function tally(summaries: Iterable<RunSummary>): Tally {
	const read = [...summaries].filter((summary) => summary.is_read)
	const shapes: ShapeCounts = new Map()
	const rephrased: RephraseCounts = new Map()

	for (const summary of read) {
		add(shapes, summary.shapes)
		add(rephrased, summary.rephrased)
	}

	const readings = rule_value.measure_states(read.map((summary) => new Map(summary.states)))

	return { runs: read.length, readings, shapes, rephrased }
}

// The code doing the counting: this module's static import closure, which reaches `read_run`, every
// rule predicate, the refusal shapes and the rephrase count. Run from `dist/`, `import.meta.url` still
// names this source file (`scripts/build/source-location.ts`), and `scripts/` ships beside it.
function counting_sources(): Array<string> {
	return [...import_closure.closure([fileURLToPath(import.meta.url)])].toSorted((left, right) =>
		left.localeCompare(right),
	)
}

// How the kept counts were computed: the measured rule ids and the content of every counting source,
// so a change to any of them reads every run again.
function version_of(sources: ReadonlyArray<string>): string {
	const ids = delivered_rules.MEASURED_RULES.map((rule) => rule.id).join(LINE)
	const hash = createHash(HASH).update(ids)

	for (const source of sources) {
		hash.update(LINE).update(file_reader.read_if_readable(source) ?? '')
	}

	return hash.digest('hex')
}

// The main checkout's store. A lane reads only its own transcripts, so it opens no store: keeping its
// runs alone would forget every other one (`rule_value_cache.is_linked_work_tree`).
function open(
	cwd: string,
	sources: ReadonlyArray<string> = counting_sources(),
): StampedStore<RunSummary> | undefined {
	if (rule_value_cache.is_linked_work_tree(cwd)) return undefined

	const file = rule_value_cache.cache_path(cwd, STORE_FILE)

	return stamped_store.open(file, version_of(sources), summary_schema)
}

const rule_value_runs = { counting_sources, open, summaries_of, summarize, tally, version_of }

export { rule_value_runs }
export type { RunSummary, Tally }
