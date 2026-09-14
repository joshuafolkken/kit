import { cost_attribute } from '#scripts/cost-runtime/cost-attribute'
import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { report_empty, type Options } from '#scripts/cost-runtime/cost-cli'
import { cost_corpus, type AttributedRecord, type Corpus } from '#scripts/cost-runtime/cost-corpus'
import { cost_optional } from '#scripts/cost-runtime/cost-optional'
import { cost_run_scope } from '#scripts/cost-runtime/cost-run-scope'
import {
	cost_transcript,
	type SessionFile,
	type SessionUsage,
} from '#scripts/cost-runtime/cost-transcript'
import { cost_usage } from '#scripts/cost-runtime/cost-usage'
import { cost_composition } from './cost-composition'
import { cost_document_sources } from './cost-document-sources'
import type { DocumentBreakdown } from './cost-documents'
import { cost_report, type CostReport, type Measurement, type MissingData } from './cost-report'
import { cost_resident } from './cost-resident'
import { cost_run_report } from './cost-run-report'
import { cost_sessions } from './cost-sessions'

// The kit-only report path of `josh cost` — the full tables, the run tree, and the JSON document.
// It is reached only through `cost-cli`'s dynamic import, so its static closure over the report
// modules (`cost_report`, `cost_composition`, `cost_resident`, `cost_run_report`, …) never lands in
// the distributed `--over` / `--cap` path (joshuafolkken/kit#1996).

const JSON_INDENT = 2

function scope_label(key: number): string {
	return key === cost_attribute.UNATTRIBUTED_KEY ? 'unattributed' : `issue #${String(key)}`
}

// The resident and context decompositions for one whole session. Built here rather than in
// `build_report` because only this scope has a transcript file to read them from.
function build_measurement(cwd: string, file: SessionFile, session: SessionUsage): Measurement {
	const blocks = cost_blocks.parse_content(cost_transcript.read_raw(file))

	return {
		resident: cost_resident.build(cwd, session.baseline_tokens),
		composition: cost_composition.build(
			blocks,
			cost_usage.sum_totals(session.records).thinking_tokens,
		),
	}
}

// A session with no readable request has a baseline of 0, and a breakdown against a baseline of 0
// is a table of estimates beside a measurement that was never made — "this could not be read"
// dressed as a reading. The text report already says so through `format_empty`; this keeps `--json`
// from saying otherwise.
function optional_measurement(
	cwd: string,
	file: SessionFile,
	session: SessionUsage,
): { measurement?: Measurement } {
	if (session.records.length === 0) return {}

	return { measurement: build_measurement(cwd, file, session) }
}

// One session — the newest by default, which is "the run that just finished". Which of the listing
// that is is `cost_transcript`'s to say, because a delegated unit is part of a run rather than a run
// of its own and it writes the newer file whenever a session delegates (joshuafolkken/kit#1285).
//
// Its missing counts are the session's own, never the corpus's. A malformed line in some unrelated
// session is not missing data about *this* one, and reporting it as such attributes a defect to the
// wrong run — the same misreading, one level up, that this command exists to stop.
function report_session(
	corpus: Corpus,
	cwd: string,
	cap: number | undefined,
): CostReport | undefined {
	const index = cost_transcript.latest_own_index(corpus.files)
	const session = corpus.sessions[index]
	const file = corpus.files[index]

	if (session === undefined || file === undefined) return undefined

	return cost_report.build_report({
		scope: `session ${session.session_id}`,
		records: session.records,
		missing: cost_corpus.accumulate_missing([session]),
		resident_billed_tokens: session.baseline_tokens * session.records.length,
		...optional_measurement(cwd, file, session),
		...cost_optional.documents(cost_document_sources.for_session(file, session)),
		...cost_optional.cap_tokens(cap),
	})
}

// The optional tail of a scope report, bundled so `to_scope_report` stays within the parameter
// limit: `--all` reads no transcripts for its documents, so it passes neither.
interface ScopeExtras {
	cap: number | undefined
	documents?: DocumentBreakdown
}

// One issue, across every session that touched it. A child implemented over two sessions — an
// interrupted run resumed later — would otherwise be reported at half its cost.
//
// Here the corpus-wide missing counts *are* the right ones: a line that could not be read carries no
// branch, so there is no way to rule out that it belonged to this issue. Each contributing session's
// own baseline, times the records it contributed, is what the scope paid to re-read the resident
// preamble — the only form that survives a scope spanning several sessions.
function to_scope_report(
	label: string,
	pairs: ReadonlyArray<AttributedRecord>,
	missing: MissingData,
	extras: ScopeExtras,
): CostReport {
	return cost_report.build_report({
		scope: label,
		records: pairs.map((pair) => pair.record),
		missing,
		resident_billed_tokens: pairs.reduce((sum, pair) => sum + pair.baseline_tokens, 0),
		curve_sessions: cost_corpus.mainline_records(pairs),
		by_session: cost_sessions.build(pairs),
		...cost_optional.cap_tokens(extras.cap),
		...cost_optional.documents(extras.documents),
	})
}

// An issue scope is the one place a unit that could not follow its parent disappears — in `--all` it
// still shows in the `unattributed` bucket — so the count is merged into `missing` here alone, marking
// `cost_usd` a floor exactly as `unpriced_models` does.
function with_unattributed(missing: MissingData, unattributed_units: number): MissingData {
	return { ...missing, unattributed_sessions: unattributed_units }
}

function report_issue(corpus: Corpus, issue_number: number, cap: number | undefined): CostReport {
	const attribution = cost_corpus.attribute_corpus(corpus)
	const pairs = cost_corpus
		.dedupe_across_sessions(attribution.pairs)
		.filter((pair) => pair.issue === issue_number)
	const floor = cost_corpus.floor_for_issue(attribution.unattributed, issue_number)
	const missing = with_unattributed(corpus.missing, floor)

	return to_scope_report(scope_label(issue_number), pairs, missing, {
		cap,
		documents: cost_document_sources.for_issue(corpus, pairs),
	})
}

function report_all(corpus: Corpus): Array<CostReport> {
	const merged = new Map<number, Array<AttributedRecord>>()

	for (const pair of cost_corpus.attributed(corpus)) {
		merged.set(pair.issue, [...(merged.get(pair.issue) ?? []), pair])
	}

	return [...merged]
		.toSorted(([left], [right]) => left - right)
		.map(([key, pairs]) =>
			to_scope_report(scope_label(key), pairs, corpus.missing, { cap: undefined }),
		)
}

// The empty check is made once, for every scope. `--all` and `--issue` used to answer an absent
// transcript directory with an empty listing and a zero-cost issue — exit 0 either way, which is
// exactly the silent zero this command exists to remove.
function build_reports(
	options: Options,
	corpus: Corpus,
	cwd: string,
): Array<CostReport> | undefined {
	if (corpus.sessions.length === 0) return undefined
	if (options.is_all) return report_all(corpus)
	if (options.issue !== undefined) return [report_issue(corpus, options.issue, options.cap)]

	const single = report_session(corpus, cwd, options.cap)

	return single === undefined ? undefined : [single]
}

function print_reports(reports: ReadonlyArray<CostReport>, is_json: boolean): void {
	if (is_json) {
		console.info(JSON.stringify(reports, undefined, JSON_INDENT))

		return
	}

	console.info(reports.map((report) => cost_report.format_report(report)).join('\n\n'))
	if (reports.length > 1) console.info(`\n${cost_report.format_totals_line(reports)}`)
}

// Everything `josh cost` reports as a table: the run tree, a session, an issue, the whole corpus,
// and the `--cap --json` document. The one-line `--over` / `--cap` verdicts never arrive here — they
// short-circuit in `cost-cli` before this module is imported.
function run(target: string, options: Options): number {
	if (cost_run_scope.wants(options)) return cost_run_report.run(target, undefined, options.is_json)

	const reports = build_reports(options, cost_corpus.load_corpus(target, options.session), target)

	if (reports === undefined) return report_empty(target, options.session)

	print_reports(reports, options.is_json)

	return 0
}

const cost_report_cli = {
	report_session,
	report_issue,
	report_all,
	build_reports,
	run,
}

export { cost_report_cli }
