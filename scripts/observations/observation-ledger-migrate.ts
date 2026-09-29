import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
	LEGACY_OBSERVATION_LEDGER_PATH,
	MIGRATION_CLAIM_SUFFIX,
	OBSERVATION_LEDGER_PATH,
} from './observation-ledger'
import { observation_ledger_line } from './observation-ledger-line'

// Moves the ledger's lines from the path it had before joshuafolkken/kit#2724 to the one it has now
// (`observation-ledger.ts` carries why both are recognized). Changing the constant alone split the
// appends across two files: a run still on the old code recreated `docs/observations.md`, and a
// consumer repository's existing ledger stayed where nothing read it. So resolving the ledger's path
// migrates first (`observation-ledger-home.ts`), and whatever reached the old path lands at the tail
// of the new one before anything reads or appends.
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

function read_or_undefined(file_path: string): string | undefined {
	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return undefined
	}
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
	appendFileSync(target, carried(readFileSync(claimed, 'utf8'), read_or_undefined(target)), 'utf8')
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

// Returns whether anything was moved. `root` is the checkout the ledger lives in.
function migrate(root: string): boolean {
	const legacy = path.join(root, LEGACY_OBSERVATION_LEDGER_PATH)
	const target = path.join(root, OBSERVATION_LEDGER_PATH)
	const recovered = absorb_stale(legacy, target)
	const claimed = claim_path(legacy)

	if (!claim(legacy, claimed)) return recovered > 0

	absorb(claimed, target)

	return true
}

const observation_ledger_migrate = { claim_path, migrate }

export { observation_ledger_migrate }
