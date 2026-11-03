import { readFile, rm } from 'node:fs/promises'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { durable_state } from '#scripts/josh/durable-state'

// **The investigator's conclusion, kept where a later read of the run finds it.** The plan phase's
// `file:line` findings lived only in the session that delegated them, so the implement phase delegated
// the same reading again — four times in one lane (joshuafolkken/kit#5765). The run writes the
// conclusion to a file outside the tree and `run:prep` prints it instead of asking for a second
// delegation. **The file is a durable run record, not one in the work tree's own git directory**: a
// lane that yields has its work tree removed, and the re-dispatched lane redid the whole reading
// (joshuafolkken/kit#6153).

const RECORD_SUFFIX = '.md'
const NO_GIT_DIRECTORY = 'no git directory to hold the investigation record'

function path_of(issue_number: string): string {
	const repository = git_common_directory.repository()

	if (repository === undefined) throw new Error(NO_GIT_DIRECTORY)

	return durable_state.path(
		durable_state.PREFIX.INVESTIGATION,
		repository,
		`-${issue_number}${RECORD_SUFFIX}`,
	)
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
		const record_path = path_of(issue_number)

		return { path: record_path, findings: await findings_at(record_path) }
	} catch {
		return undefined
	}
}

// Removed once the pull request merged, as the ship body draft is, and once a closed issue's lane is
// withdrawn: a record left behind would hand a reopened issue's run the old findings. One no path
// removes is pruned after the durable state's retention (`durable-state-migrate.ts`).
async function remove(issue_number: string): Promise<void> {
	await rm(path_of(issue_number), { force: true })
}

const run_investigation_record = { load, remove }

export type { InvestigationRecord }
export { run_investigation_record }
