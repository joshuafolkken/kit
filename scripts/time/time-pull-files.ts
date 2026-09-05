import { json_value } from '#scripts/json-value'
import { z } from 'zod'
import { time_github, type GhReader } from './time-github'

// The merged diff itself — which files a run's pull request actually changed, and by how much
// (joshuafolkken/kit#1387).
//
// `josh time` reads the transcript and GitHub's pull-request listing, and neither says what landed.
// So an edit made mid-implementation and then abandoned — `scripts/verification-gate.ts` was edited
// twice on run #1379 and appears nowhere in that run's diff — is invisible, and so is the run's size:
// 27 minutes on a 254-line change and 27 minutes on a 4-line one read as the same figure and cannot be
// compared.
//
// **This is `time-github.ts`'s layer, in a second file.** That module sits at its 300-line limit, and
// splitting it along one of its four reads would have moved code no part of this Issue touches. So the
// read goes through that module's own `GhReader` and its `PULLS_PATH`, and nothing here reaches for
// `git_gh_exec` — the same REST layer, the same request budget, the same error translation.

const FILE_SCHEMA = z.object({
	filename: z.string().nullish(),
	additions: z.number().nullish(),
	deletions: z.number().nullish(),
})

const FILES_SCHEMA = z.array(FILE_SCHEMA)

// One row of the merged diff. Only the three fields a reconciliation and a size need: the patch text,
// the blob shas and the status are a question this command does not ask, and retaining them would keep
// every changed line of every measured run in memory for the length of a batch.
interface PullFile {
	path: string
	additions: number
	deletions: number
}

// What a read of the file listing produced, in the two states a read has — the shape `CheckRunList`
// and `CommitList` already carry, deliberately spelled the same. **A refused read is not a pull
// request that changed nothing**, and reporting the second for the first is the silent zero this
// command exists to remove: every edited file would then read as "never reached the merged diff".
interface PullFileList {
	files: ReadonlyArray<PullFile>
	is_failed: boolean
}

const FAILED_FILES: PullFileList = { files: [], is_failed: true }

function to_file(raw: z.infer<typeof FILE_SCHEMA>): PullFile | undefined {
	const path = raw.filename ?? ''

	if (path === '') return undefined

	return { path, additions: raw.additions ?? 0, deletions: raw.deletions ?? 0 }
}

// **A row carrying no filename makes the whole listing unreadable rather than being dropped** — the
// rule `parse_commits` states, for the same reason. Every row GitHub sends has one, so a row without
// it is a shape this code does not understand, and a listing short one file is a reconciliation that
// reports that file as abandoned work when it merely was not read.
//
// `undefined` is also what a body that does not parse answers: `gh` hands an error object back having
// exited 0, and laundering that into an empty file list is the same as swallowing a 403.
function parse_pull_files(text: string): Array<PullFile> | undefined {
	const parsed = FILES_SCHEMA.safeParse(json_value.parse_or_undefined(text))

	if (!parsed.success) return undefined

	const files = parsed.data.map((raw) => to_file(raw))

	if (files.includes(undefined)) return undefined

	return files.filter((file): file is PullFile => file !== undefined)
}

// **A full page is withheld rather than read as complete.** One page is what this reads, and a page of
// exactly `PAGE_SIZE` rows cannot be told from a truncated one — so a pull request with a hundred
// changed files would report a size short of the truth and mark whatever sat past the cut as never
// having landed. A `fullrun` never comes near it; the run that does gets `not measured`, which is the
// true answer.
function is_whole_listing(files: ReadonlyArray<PullFile>): boolean {
	return files.length < time_github.PAGE_SIZE
}

function files_path(pull_number: number): string {
	const page = `per_page=${String(time_github.PAGE_SIZE)}`

	return `${time_github.PULLS_PATH}/${String(pull_number)}/files?${page}`
}

// Every file one pull request changed, in GitHub's own order. One request per measured run, made
// beside the check-runs read rather than after it.
async function list_pull_files(
	pull_number: number,
	read: GhReader = time_github.read_gh,
): Promise<PullFileList> {
	try {
		const files = parse_pull_files(await read(files_path(pull_number)))

		if (files === undefined || !is_whole_listing(files)) return FAILED_FILES

		return { files, is_failed: false }
	} catch {
		return FAILED_FILES
	}
}

const time_pull_files = {
	FAILED_FILES,
	files_path,
	parse_pull_files,
	list_pull_files,
}

export type { PullFile, PullFileList }
export { time_pull_files }
