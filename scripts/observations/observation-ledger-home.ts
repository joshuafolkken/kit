import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { git_branch } from '#scripts/git/git-branch'
import { git_spawn } from '#scripts/git/git-spawn'
import { observation_ledger, OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'
import { observation_ledger_migrate } from './observation-ledger-migrate'

// Where the observation ledger is read and written, whichever work tree a command runs in.
//
// **The ledger lives in the work tree the command runs in — a lane's in a lane**.
// Resolved to the primary checkout from every lane, a lane's lines would wait there for a batch-end
// flush; another run's stash of that checkout would take them, the flush would read `git status` and
// find nothing, and the lines would be lost. Each run appends to its own
// issue's file in its own tree, `git-staging.ts` commits it with the run, and `pnpm josh followup`
// commits whatever was appended after that commit before it merges — so a lane's lines reach the
// default branch with the lane's own pull request, and the primary checkout holds none of them.

const DATE_END = 10

function ledger_root(cwd: string = process.cwd()): string {
	return cwd
}

// **Resolving the directory migrates the single-file ledgers first**. Every reader and writer asks here — `review:record --check`,
// `review:findings`, the retrospective, the stash carry's duplicate check — so none of them can read a
// directory without the lines that still sit at an old path, which for the review-record check would
// answer `missing` for a round recorded before the move.
function ledger_directory(cwd: string = process.cwd()): string {
	const root = ledger_root(cwd)

	observation_ledger_migrate.migrate(root)

	return path.join(root, OBSERVATION_LEDGER_DIRECTORY)
}

function file_path(name: number | string, cwd: string): string {
	ledger_directory(cwd)

	return path.join(ledger_root(cwd), observation_ledger.ledger_file(name))
}

function issue_path(issue: number, cwd: string = process.cwd()): string {
	return file_path(issue, cwd)
}

async function current_branch(cwd: string): Promise<string> {
	try {
		return await git_spawn.read(['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])
	} catch {
		return ''
	}
}

// The `<YYYY-MM-DD>` a ledger line carries, and the name of a date file — one spelling for every
// writer, so a line and the file it lands in never disagree about the day.
function ledger_date(now: Date): string {
	return now.toISOString().slice(0, DATE_END)
}

// **The file a writer that names no issue appends to** — the issue the checked-out branch leads with
// (`2919-lane`, `2919-store-the-ledger`), so a lane's lines land in its own issue's file; or the date,
// for a line written on the default branch outside any issue's run, which `pnpm josh
// observations:flush` commits.
async function writer_path(now: Date, cwd: string = process.cwd()): Promise<string> {
	const issue = git_branch.issue_from_branch(await current_branch(cwd))

	return file_path(issue ?? ledger_date(now), cwd)
}

// A file whose last line has no newline would otherwise run into the next file's first line.
async function read_file(target: string): Promise<string> {
	try {
		const content = await readFile(target, 'utf8')

		return content.length === 0 || content.endsWith('\n') ? content : `${content}\n`
	} catch {
		return ''
	}
}

async function ledger_files(directory: string): Promise<ReadonlyArray<string> | undefined> {
	try {
		const names = await readdir(directory)

		return names
			.filter((name) => observation_ledger.is_ledger_file_name(name))
			.toSorted((left, right) => left.localeCompare(right))
	} catch {
		return undefined
	}
}

// **Every file in the directory, read as one ledger**, in name order so the answer is stable. Readers
// count across all of them — a recurrence is a recurrence whichever issue's file each line sits in.
// `undefined` when there is no directory: a checkout that keeps no ledger, which `review:record
// --check` turns into `not-required`.
async function read(cwd: string = process.cwd()): Promise<string | undefined> {
	const directory = ledger_directory(cwd)
	const files = await ledger_files(directory)

	if (files === undefined) return undefined

	const contents = await Promise.all(
		files.map(async (name) => await read_file(path.join(directory, name))),
	)

	return contents.join('')
}

// The one append every ledger writer goes through. A consumer that does not keep the ledger has no
// `docs/` at its root, so the parent is created first — the one write path that can bring the ledger
// into existence there.
async function append(target: string, lines: ReadonlyArray<string>): Promise<void> {
	if (lines.length === 0) return

	await mkdir(path.dirname(target), { recursive: true })
	await appendFile(target, `${lines.join('\n')}\n`, 'utf8')
}

const observation_ledger_home = {
	append,
	issue_path,
	ledger_date,
	ledger_root,
	read,
	writer_path,
}

export { observation_ledger_home }
