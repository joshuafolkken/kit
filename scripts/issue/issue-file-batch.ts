import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { error_text } from '#scripts/lib/error-message'
import { issue_file_batch_entries, type BatchEntry } from './issue-file-batch-entries'
import { issue_file_cli } from './issue-file-cli'

// `josh issue:file --batch <dir> [<flag>]…` — file every body file in `<dir>` in one call, each through
// the whole `issue:file` filing with the shared flags appended. A filing a step refuses stays unfiled
// while the rest go on; the summary names each filed URL and each refused body file, and any refusal
// exits 1. `issue-file-main.ts` hands an argument list without `--batch` to `issue_file_cli.run`.

interface Outcome {
	entry: BatchEntry
	url: string | undefined
}

const BATCH_FLAG = '--batch'
// `--batch` and the directory after it.
const BATCH_FLAG_WIDTH = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const MISSING_DIRECTORY_MESSAGE = '`--batch` needs the directory of body files after it.'

function argv_of(
	entry: BatchEntry,
	body_file: string,
	shared: ReadonlyArray<string>,
): Array<string> {
	const distinct = entry.distinct === undefined ? [] : ['--distinct', entry.distinct]

	return [entry.title, '--body-file', body_file, ...distinct, ...shared]
}

async function file_entry(
	entry: BatchEntry,
	body_file: string,
	shared: ReadonlyArray<string>,
): Promise<Outcome> {
	console.info(`── ${entry.source} — ${entry.title}`)
	await writeFile(body_file, entry.body)

	return { entry, url: await issue_file_cli.file_issue(argv_of(entry, body_file, shared)) }
}

// In order, one at a time: the filing cap and the fold question count the filings before each one.
async function file_all(
	entries: ReadonlyArray<BatchEntry>,
	shared: ReadonlyArray<string>,
): Promise<ReadonlyArray<Outcome>> {
	const work = await mkdtemp(path.join(tmpdir(), 'issue-file-batch-'))
	const outcomes: Array<Outcome> = []

	try {
		for (const [index, entry] of entries.entries()) {
			const body_file = path.join(work, `${String(index)}.md`)

			// eslint-disable-next-line no-await-in-loop -- each filing reads the ones before it
			outcomes.push(await file_entry(entry, body_file, shared))
		}
	} finally {
		await rm(work, { recursive: true, force: true })
	}

	return outcomes
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

async function entries_in(directory: string): Promise<ReadonlyArray<BatchEntry>> {
	try {
		return await issue_file_batch_entries.entries_of(directory)
	} catch (error) {
		console.error(
			`Could not read the batch directory ${directory}: ${error_text.message_of(error)}`,
		)

		return []
	}
}

async function run_batch(directory: string, shared: ReadonlyArray<string>): Promise<number> {
	const entries = await entries_in(directory)

	if (entries.length === 0) {
		console.error(`issue:file --batch — no *.md body files in ${directory}; nothing filed.`)

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
	const directory = index === -1 ? undefined : argv[index + 1]

	if (directory === undefined) {
		console.error(MISSING_DIRECTORY_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	return await run_batch(directory, argv.toSpliced(index, BATCH_FLAG_WIDTH))
}

const issue_file_batch = { is_batch, run }

export { issue_file_batch }
