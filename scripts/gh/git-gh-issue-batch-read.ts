import { git_gh_issue_batch_graphql } from './git-gh-issue-batch-graphql'

// Issues read the batched way: one GraphQL query per hundred (`git-gh-issue-batch-graphql.ts`)
// answers what it can, and every number it left unanswered — all of them in a session on REST — is
// read through REST one by one, as before the batch (joshuafolkken/kit#6792, #6869).

// How `read_each` reads one repository: `fields` is the REST read's `--json` list (a
// state-and-relations read when absent), `from_json` takes a batch answer in that shape, and
// `read_rest` reads one number the batch left unanswered.
interface BatchReader<T> {
	repo?: string | undefined
	fields?: string
	from_json: (json: string) => T
	read_rest: (issue_number: number) => Promise<T>
}

// Each number's read, in the order given.
async function read_each<T>(
	issue_numbers: ReadonlyArray<number>,
	reader: BatchReader<T>,
): Promise<Array<[number, T]>> {
	const { reads } = await git_gh_issue_batch_graphql.read_many(
		issue_numbers,
		reader.repo,
		reader.fields,
	)

	return await Promise.all(
		issue_numbers.map(async (issue_number): Promise<[number, T]> => {
			const read = reads.get(issue_number)
			const value =
				read?.kind === 'read' ? reader.from_json(read.json) : await reader.read_rest(issue_number)

			return [issue_number, value]
		}),
	)
}

// An issue by number, in the repository `--repo` names (this one when absent).
interface IssueAt {
	number: number
	repo?: string | undefined
}

// Issues that may live in several repositories, read through `read_each` one repository at a time
// and answered in the order given.
async function read_across<T>(
	issues: ReadonlyArray<IssueAt>,
	reader_for: (repo: string | undefined) => BatchReader<T>,
): Promise<Array<T | undefined>> {
	const repos = [...new Set(issues.map((issue) => issue.repo))]
	const reads = await Promise.all(
		repos.map(async (repo) => {
			const numbers = issues.filter((issue) => issue.repo === repo).map((issue) => issue.number)

			return new Map(await read_each(numbers, reader_for(repo)))
		}),
	)

	return issues.map((issue) => reads[repos.indexOf(issue.repo)]?.get(issue.number))
}

const git_gh_issue_batch_read = { read_across, read_each }

export type { BatchReader, IssueAt }
export { git_gh_issue_batch_read }
