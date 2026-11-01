import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { error_text } from '#scripts/lib/error-message'
import { issue_file_batch_entries, type BatchEntry } from './issue-file-batch-entries'
import { issue_file_cli } from './issue-file-cli'
import type { ScoutOutcome } from './issue-scout-cli'

// `josh issue:file --batch <dir|file> [<flag>]…` — file every body file in `<dir>`, or every part of
// one `%%%`-separated file, in one call, each through the whole `issue:file` filing with the shared
// flags appended. Every filing's scout runs first and its reports print together once. A filing a step
// refuses stays unfiled while the rest go on; the summary names each filed URL and each refused body,
// and any refusal exits 1. `issue-file-main.ts` hands an argument list without `--batch` to
// `issue_file_cli.run`.

interface Planned {
	entry: BatchEntry
	argv: ReadonlyArray<string>
}

interface Outcome {
	entry: BatchEntry
	url: string | undefined
}

const BATCH_FLAG = '--batch'
// `--batch` and the path after it.
const BATCH_FLAG_WIDTH = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const MISSING_SOURCE_MESSAGE =
	'`--batch` needs a directory of body files, or one file split at `%%%` lines, after it.'
const SCOUT_UNANSWERED = 'The scout could not answer — the filing scouts again.'

function argv_of(
	entry: BatchEntry,
	body_file: string,
	shared: ReadonlyArray<string>,
): Array<string> {
	const distinct = entry.distinct === undefined ? [] : ['--distinct', entry.distinct]

	return [entry.title, '--body-file', body_file, ...distinct, ...shared]
}

function heading_of(entry: BatchEntry): string {
	return `── ${entry.source} — ${entry.title}`
}

async function planned_of(
	entries: ReadonlyArray<BatchEntry>,
	work: string,
	shared: ReadonlyArray<string>,
): Promise<ReadonlyArray<Planned>> {
	return await Promise.all(
		entries.map(async (entry, index) => {
			const body_file = path.join(work, `${String(index)}.md`)

			await writeFile(body_file, entry.body)

			return { entry, argv: argv_of(entry, body_file, shared) }
		}),
	)
}

// Every filing's scout before the first filing, its reports printed together once; a filing whose
// scout could not answer scouts again in its own filing.
async function scout_all(
	planned: ReadonlyArray<Planned>,
): Promise<ReadonlyArray<ScoutOutcome | undefined>> {
	const outcomes = await Promise.all(
		planned.map(async ({ argv }) => await issue_file_cli.scout(argv)),
	)
	const sections = planned.map(({ entry }, index) => {
		const report = outcomes[index]?.report ?? SCOUT_UNANSWERED

		return `${heading_of(entry)}\n${report}`
	})

	console.info([`issue:file --batch — scout`, ...sections].join('\n'))

	return outcomes
}

// The combined report predates this batch's own filings, so a filing after one of them is scouted
// again to hold a near-duplicate of it; that report prints only when it names a new candidate.
async function scout_again(
	argv: ReadonlyArray<string>,
	earlier: ScoutOutcome | undefined,
): Promise<ScoutOutcome | undefined> {
	const outcome = await issue_file_cli.scout(argv)
	const known = earlier?.candidates ?? []

	if (outcome?.candidates.some((number) => !known.includes(number)) === true) {
		console.info(outcome.report)
	}

	return outcome
}

// In order, one at a time: the filing cap and the fold question count the filings before each one.
async function file_in_order(
	planned: ReadonlyArray<Planned>,
	scouted: ReadonlyArray<ScoutOutcome | undefined>,
): Promise<ReadonlyArray<Outcome>> {
	const outcomes: Array<Outcome> = []

	for (const [index, { entry, argv }] of planned.entries()) {
		console.info(heading_of(entry))
		const has_filed = outcomes.some((outcome) => outcome.url !== undefined)
		// eslint-disable-next-line no-await-in-loop -- each filing reads the ones before it
		const scout = has_filed ? await scout_again(argv, scouted[index]) : scouted[index]

		// eslint-disable-next-line no-await-in-loop -- each filing reads the ones before it
		outcomes.push({ entry, url: await issue_file_cli.file_issue(argv, scout) })
	}

	return outcomes
}

async function file_all(
	entries: ReadonlyArray<BatchEntry>,
	shared: ReadonlyArray<string>,
): Promise<ReadonlyArray<Outcome>> {
	const work = await mkdtemp(path.join(tmpdir(), 'issue-file-batch-'))

	try {
		const planned = await planned_of(entries, work, shared)

		return await file_in_order(planned, await scout_all(planned))
	} finally {
		await rm(work, { recursive: true, force: true })
	}
}

function summary_of(outcomes: ReadonlyArray<Outcome>): string {
	const filed = outcomes.filter((outcome) => outcome.url !== undefined)
	const lines = outcomes.map(({ entry, url }) =>
		url === undefined
			? `  ✖ refused: ${entry.source} — ${entry.title}`
			: `  ✔ ${url} — ${entry.title}`,
	)

	return [
		`issue:file --batch — filed ${String(filed.length)} of ${String(outcomes.length)}`,
		...lines,
	].join('\n')
}

async function entries_in(source: string): Promise<ReadonlyArray<BatchEntry>> {
	try {
		return await issue_file_batch_entries.entries_of(source)
	} catch (error) {
		console.error(`Could not read the batch ${source}: ${error_text.message_of(error)}`)

		return []
	}
}

async function run_batch(source: string, shared: ReadonlyArray<string>): Promise<number> {
	const entries = await entries_in(source)

	if (entries.length === 0) {
		console.error(`issue:file --batch — no filing in ${source}; nothing filed.`)

		return FAILURE_EXIT_CODE
	}

	const outcomes = await file_all(entries, shared)

	console.info(summary_of(outcomes))

	return outcomes.every((outcome) => outcome.url !== undefined)
		? SUCCESS_EXIT_CODE
		: FAILURE_EXIT_CODE
}

function is_batch(argv: ReadonlyArray<string>): boolean {
	return argv.includes(BATCH_FLAG)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const index = argv.indexOf(BATCH_FLAG)
	const source = index === -1 ? undefined : argv[index + 1]

	if (source === undefined) {
		console.error(MISSING_SOURCE_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	return await run_batch(source, argv.toSpliced(index, BATCH_FLAG_WIDTH))
}

const issue_file_batch = { is_batch, run }

export { issue_file_batch }
