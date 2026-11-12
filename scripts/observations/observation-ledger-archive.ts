import { existsSync, readFileSync } from 'node:fs'
import { appendFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { git_gh_issue_alias_graphql } from '#scripts/gh/git-gh-issue-alias-graphql'
import { error_text } from '#scripts/lib/error-message'
import { z } from 'zod'
import {
	CARRIED_ROUNDS_SUFFIX,
	LEDGER_FILE_EXTENSION,
	OBSERVATION_LEDGER_DIRECTORY,
} from './observation-ledger'
import { observation_ledger_home } from './observation-ledger-home'

// The ledger's retention: archive, never expire (`docs/maintainers/observation-ledger-rationale.md` →
// "Retention policy", joshuafolkken/kit#7336). A closed issue's `<issue>.md` and
// `<issue>-comment-rounds.md` move, verbatim and in name order, into `archive-YYYY-MM.md` for the month
// the issue closed — the same directory, so `observation_ledger_home.read` still counts every line.
//
// **Only `observations:flush` runs it, on the default branch**: parallel lanes writing one archive
// file would conflict. An issue GitHub did not answer as closed keeps its file until a later flush.
//
// **The carried mark survives the move**: the carry treats an issue whose rounds file exists as
// carried, so each archived rounds file's issue is listed in `archived-comment-rounds.txt`, which the
// carry reads too. It is not a `.md` file, so no reader takes it for ledger lines.

const ARCHIVE_PREFIX = 'archive-'
const ARCHIVED_ROUNDS_FILE = 'archived-comment-rounds.txt'
const ISSUE_FILE_PATTERN = new RegExp(
	String.raw`^(?<issue>\d+)(?<rounds>${CARRIED_ROUNDS_SUFFIX})?\.md$`,
	'u',
)
const CLOSED_FIELDS = 'state closedAt'
const CLOSED_STATE = 'CLOSED'
const MONTH_END = 7
const NONE = 0
const ARCHIVED_LINE = "closed issues' ledger file(s) moved into the monthly archive files."
const ARCHIVE_FAILED_LINE =
	"Could not archive the closed issues' ledger files; the next flush retries:"

const closed_schema = z.object({ state: z.string(), closedAt: z.string().nullish() })

interface IssueFile {
	name: string
	issue: number
	is_rounds: boolean
}

function issue_file_of(name: string): IssueFile | undefined {
	const groups = ISSUE_FILE_PATTERN.exec(name)?.groups

	if (groups?.['issue'] === undefined) return undefined

	return { name, issue: Number(groups['issue']), is_rounds: groups['rounds'] !== undefined }
}

function issue_files(names: ReadonlyArray<string>): Array<IssueFile> {
	return names
		.toSorted((left, right) => left.localeCompare(right))
		.flatMap((name) => issue_file_of(name) ?? [])
}

function archive_name(closed_at: string): string {
	return `${ARCHIVE_PREFIX}${closed_at.slice(0, MONTH_END)}${LEDGER_FILE_EXTENSION}`
}

// The archive file of each closed issue; an open issue, or one GitHub did not answer, is absent.
async function closed_archives(issues: ReadonlyArray<number>): Promise<Map<number, string>> {
	const read = await git_gh_issue_alias_graphql.read_aliased(issues, CLOSED_FIELDS, closed_schema)

	return new Map(
		[...read.answers].flatMap(([issue, answer]) =>
			answer.state === CLOSED_STATE && typeof answer.closedAt === 'string'
				? [[issue, archive_name(answer.closedAt)] as const]
				: [],
		),
	)
}

function by_archive(
	files: ReadonlyArray<IssueFile>,
	archives: ReadonlyMap<number, string>,
): Map<string, Array<IssueFile>> {
	const groups = new Map<string, Array<IssueFile>>()

	for (const file of files) {
		const target = archives.get(file.issue)

		if (target !== undefined) groups.set(target, [...(groups.get(target) ?? []), file])
	}

	return groups
}

// Written before the sources are removed: a stop between the two leaves a duplicate in the working
// tree, which `git checkout` undoes, rather than a lost line.
async function move(
	directory: string,
	target: string,
	files: ReadonlyArray<IssueFile>,
): Promise<void> {
	const contents = await Promise.all(
		files.map(
			async (file) =>
				await observation_ledger_home.read_file(path.join(directory, file.name), true),
		),
	)

	await appendFile(path.join(directory, target), contents.join(''), 'utf8')
	await Promise.all(
		files.map(async (file) => {
			await rm(path.join(directory, file.name))
		}),
	)
}

function archived_rounds_path(root: string): string {
	return path.join(root, OBSERVATION_LEDGER_DIRECTORY, ARCHIVED_ROUNDS_FILE)
}

async function record_rounds(root: string, files: ReadonlyArray<IssueFile>): Promise<void> {
	const issues = files.filter((file) => file.is_rounds).map((file) => String(file.issue))

	if (issues.length > NONE) {
		await appendFile(archived_rounds_path(root), `${issues.join('\n')}\n`, 'utf8')
	}
}

// The issues whose carried rounds file was archived — carried, so the carry never reads them again.
function archived_rounds(root: string): ReadonlySet<number> {
	const target = archived_rounds_path(root)

	if (!existsSync(target)) return new Set()

	return new Set(readFileSync(target, 'utf8').split('\n').filter(Boolean).map(Number))
}

// Moves every closed issue's ledger files into its month's archive, and answers how many it moved.
async function archive(root: string): Promise<number> {
	const directory = path.join(root, OBSERVATION_LEDGER_DIRECTORY)

	if (!existsSync(directory)) return NONE

	const files = issue_files(await readdir(directory))
	const groups = by_archive(files, await closed_archives(files.map((file) => file.issue)))
	const moved = [...groups.values()].flat()

	await Promise.all(
		[...groups].map(async ([name, group]) => {
			await move(directory, name, group)
		}),
	)
	await record_rounds(root, moved)

	return moved.length
}

// **An archive that fails never fails the flush**: the files stay where they are and the next flush
// moves them, so `0` is returned.
async function archive_reported(root: string): Promise<number> {
	try {
		const count = await archive(root)

		if (count > NONE) console.info(`Archived ${String(count)} ${ARCHIVED_LINE}`)

		return count
	} catch (error) {
		console.warn(`${ARCHIVE_FAILED_LINE} ${error_text.message_of(error)}`)

		return NONE
	}
}

const observation_ledger_archive = {
	ARCHIVE_FAILED_LINE,
	archive,
	archive_reported,
	archived_rounds,
}

export { observation_ledger_archive }
