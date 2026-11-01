import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'

// **The investigator's conclusion, kept where a later read of the run finds it.** The plan phase's
// `file:line` findings lived only in the session that delegated them, so the implement phase delegated
// the same reading again — four times in one lane (joshuafolkken/kit#5765). The run writes the
// conclusion to a file in the work tree's own git directory — outside the tree, as the ship body draft
// is (`run-ship-body-draft.ts`) — and `run:prep` prints it instead of asking for a second delegation.

const RECORD_PREFIX = 'josh-investigation-'
const RECORD_SUFFIX = '.md'
const NO_GIT_DIRECTORY = 'no git directory to hold the investigation record'

async function path_of(issue_number: string): Promise<string> {
	const [git_directory] = await git_command.git_directories()

	if (git_directory === undefined) throw new Error(NO_GIT_DIRECTORY)

	return path.join(git_directory, `${RECORD_PREFIX}${issue_number}${RECORD_SUFFIX}`)
}

// Where the record goes and what it holds — `findings` is `undefined` when none was written or it holds
// only whitespace.
interface InvestigationRecord {
	path: string
	findings: string | undefined
}

async function findings_at(record_path: string): Promise<string | undefined> {
	try {
		const text = await readFile(record_path, 'utf8')

		return text.trim() === '' ? undefined : text.trim()
	} catch {
		return undefined
	}
}

// `undefined` only where no git directory answers, so `run:prep` still prints the rest of its bundle.
async function load(issue_number: string): Promise<InvestigationRecord | undefined> {
	try {
		const record_path = await path_of(issue_number)

		return { path: record_path, findings: await findings_at(record_path) }
	} catch {
		return undefined
	}
}

// Removed once the pull request merged, as the ship body draft is: a record left in a git directory no
// lane close prunes (the main checkout's `.git`) would hand a reopened issue's run the old findings.
async function remove(issue_number: string): Promise<void> {
	await rm(await path_of(issue_number), { force: true })
}

const run_investigation_record = { load, remove }

export type { InvestigationRecord }
export { run_investigation_record }
