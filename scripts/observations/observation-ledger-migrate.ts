import {
	appendFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
} from 'node:fs'
import path from 'node:path'
import { file_reader } from '#scripts/lib/read-file'
import {
	LEDGER_FILE_EXTENSION,
	LEGACY_LEDGER_FILE,
	LEGACY_OBSERVATION_LEDGER_DIRECTORY,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	MIGRATION_CLAIM_SUFFIX,
	OBSERVATION_LEDGER_DIRECTORY,
} from './observation-ledger'
import { observation_ledger_line } from './observation-ledger-line'

// Moves the ledger's lines from its old single files into the directory, as `legacy.md`
// (`observation-ledger.ts` carries why the old paths are still recognized). Changing a constant alone splits the appends: a run still on the old code recreates the
// old file, and a consumer repository's existing ledger stays where nothing reads it. So resolving the
// ledger migrates first (`observation-ledger-home.ts`), and whatever reached an old path lands in the
// directory before anything reads or appends.
//
// **The old file is claimed with a rename before it is read.** Two sessions resolving the ledger at
// once would otherwise both read it and both copy its lines — and a repeated line under one key is
// what promotes an observation to an issue. A rename succeeds for exactly one of them; the other finds
// nothing.
//
// **A claim whose process is gone is absorbed like the old file itself.** A process killed between the
// rename and the append leaves the ledger's lines only in the claim file; the next migration finds it
// by its name and moves it, so no line is stranded where nothing looks.
//
// **Synchronous on purpose**: the path resolver every reader and writer calls is synchronous, and a
// migration with no await point cannot be interleaved with another write in the same process.

const NEWLINE = '\n'
const NO_SIGNAL = 0
const NO_SUCH_PROCESS = 'ESRCH'

function claim_path(legacy: string): string {
	return `${legacy}.${String(process.pid)}${MIGRATION_CLAIM_SUFFIX}`
}

function claim(from: string, to: string): boolean {
	try {
		renameSync(from, to)

		return true
	} catch {
		return false
	}
}

// Only `ESRCH` means the process is gone; `EPERM` means it runs under another user, and its claim is
// still its own.
function is_alive(pid: number): boolean {
	try {
		process.kill(pid, NO_SIGNAL)

		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== NO_SUCH_PROCESS
	}
}

// A claim is named `<old ledger>.<pid>.migrating`, so the pid is what sits between the two.
function is_stale_claim(name: string, legacy_name: string): boolean {
	const prefix = `${legacy_name}.`

	if (!name.startsWith(prefix) || !name.endsWith(MIGRATION_CLAIM_SUFFIX)) return false

	const pid = Number(name.slice(prefix.length, -MIGRATION_CLAIM_SUFFIX.length))

	return Number.isSafeInteger(pid) && !is_alive(pid)
}

function stale_claims(legacy: string): ReadonlyArray<string> {
	const directory = path.dirname(legacy)

	try {
		return readdirSync(directory)
			.filter((name) => is_stale_claim(name, path.basename(legacy)))
			.map((name) => path.join(directory, name))
	} catch {
		return []
	}
}

function terminated(content: string): string {
	return content.length === 0 || content.endsWith(NEWLINE) ? content : `${content}${NEWLINE}`
}

// What of the claimed file goes to the ledger's tail: all of it, verbatim, when there is no ledger yet,
// and otherwise only the lines the ledger does not already hold. **The old file can come back after
// its lines were moved** — `git restore`, `git reset --hard` or a stash without `-u` restores a
// tracked old ledger beside the untracked new one — and copying it whole again would repeat every line
// in the history, which the digest reads as every observation recurring.
function carried(content: string, ledger: string | undefined): string {
	if (ledger === undefined) return terminated(content)

	const lines = content.split(NEWLINE).filter((line) => line.length > 0)
	const missing = observation_ledger_line.missing_lines(lines, ledger)

	return missing.length === 0 ? '' : `${missing.join(NEWLINE)}${NEWLINE}`
}

// Moves one claimed file's lines to the tail of the ledger, then removes the claim.
function absorb(claimed: string, target: string): void {
	mkdirSync(path.dirname(target), { recursive: true })
	appendFileSync(
		target,
		carried(readFileSync(claimed, 'utf8'), file_reader.read_if_readable(target)),
		'utf8',
	)
	rmSync(claimed)
}

function absorb_stale(legacy: string, target: string): number {
	let count = 0

	for (const stale of stale_claims(legacy)) {
		const claimed = claim_path(legacy)

		if (!claim(stale, claimed)) continue

		absorb(claimed, target)
		count += 1
	}

	return count
}

function migrate_one(legacy: string, target: string): boolean {
	const recovered = absorb_stale(legacy, target)
	const claimed = claim_path(legacy)

	if (!claim(legacy, claimed)) return recovered > 0

	absorb(claimed, target)

	return true
}

// The ledger file a name in the old directory belongs to — a claim `<name>.md.<pid>.migrating` left by
// a killed process included, whose `<name>.md` may already be gone.
function source_name(name: string): string | undefined {
	const end = name.indexOf(LEDGER_FILE_EXTENSION)

	return end === -1 ? undefined : name.slice(0, end + LEDGER_FILE_EXTENSION.length)
}

function legacy_directory_names(directory: string): ReadonlyArray<string> {
	try {
		const names = readdirSync(directory).map((name) => source_name(name))

		return [...new Set(names.filter((name) => name !== undefined))]
	} catch {
		return []
	}
}

// **The old directory moves file by file into the same names**, so an
// issue's lines stay in that issue's file; the emptied directory is removed when nothing else is left.
function migrate_directory(root: string): boolean {
	const legacy_directory = path.join(root, LEGACY_OBSERVATION_LEDGER_DIRECTORY)
	const did_move = legacy_directory_names(legacy_directory)
		.map((name) =>
			migrate_one(
				path.join(legacy_directory, name),
				path.join(root, OBSERVATION_LEDGER_DIRECTORY, name),
			),
		)
		.some(Boolean)

	try {
		rmdirSync(legacy_directory)
	} catch {
		// Absent, or still holding something that is not the ledger's — left where it is.
	}

	return did_move
}

// Returns whether anything was moved. `root` is the checkout the ledger lives in. Every old path is
// tried — `map` before `some`, so one that moved does not leave the next one where it was.
function migrate(root: string): boolean {
	const target = path.join(root, OBSERVATION_LEDGER_DIRECTORY, LEGACY_LEDGER_FILE)
	const moved_files = LEGACY_OBSERVATION_LEDGER_PATHS.map((legacy) =>
		migrate_one(path.join(root, legacy), target),
	)

	return [...moved_files, migrate_directory(root)].some(Boolean)
}

const observation_ledger_migrate = { migrate }

export { observation_ledger_migrate }
