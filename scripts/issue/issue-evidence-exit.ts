import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_body } from '#scripts/josh/cli-body'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'

// The shape every evidence exit shares — `josh issue:already-done` and `josh issue:measured`: the
// evidence comment, the exit's own finishing write, then the `run:release`, in that order.
//
// **The order is the point.** The finishing write without the comment is an uncited claim, so the
// comment goes first and each step runs only once the one before it landed — a failure stops there
// and names the step.

const FAILURE_EXIT_CODE = 1
const EVIDENCE_FILE_FLAG = '--evidence-file'
const OPTIONS = { 'evidence-file': { type: 'string' } } as const

interface EvidenceRequest {
	issue_number: string
	evidence: string
}

// `admit`, when given, runs once the request parsed and before the first write: an exit that does not
// fit the Issue refuses there, with nothing written.
interface EvidenceExit {
	command: string
	finish: (issue_number: string) => Promise<boolean>
	admit?: (issue_number: string) => Promise<boolean>
}

// An evidence file that is empty or whitespace only is refused before anything is written: a comment
// with no citations is not the finding an exit is for. The throw carries the reason to `run`.
function parse_request(argv: ReadonlyArray<string>): EvidenceRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const issue_number = issue_number_shape.single_of(parsed.positionals)
	const file_path = parsed.values['evidence-file']
	if (issue_number === undefined || file_path === undefined) return undefined
	const evidence = cli_body.read_file_or_stdin(file_path).trim()
	if (evidence.length === 0) throw new Error(`Evidence file is empty: ${file_path}`)

	return { issue_number, evidence }
}

// A file-read failure or an empty file is an `Error` naming the path, printed as-is; every other
// refusal is `undefined`, which the usage line explains.
function resolve_request(
	argv: ReadonlyArray<string>,
	command: string,
): EvidenceRequest | undefined {
	try {
		const request = parse_request(argv)

		if (request === undefined) {
			console.error(`Usage: josh ${command} <issue-number> ${EVIDENCE_FILE_FLAG} <path>`)
		}

		return request
	} catch (error) {
		console.error(error_text.message_of(error))

		return undefined
	}
}

async function post_evidence(request: EvidenceRequest): Promise<boolean> {
	try {
		console.info(await git_gh_command.issue_comment(request.issue_number, request.evidence))

		return true
	} catch (error) {
		console.error(`Evidence comment not posted: ${error_text.message_of(error)}`)

		return false
	}
}

// Each write runs only once the one before it landed: `&&` stops at the first that did not.
async function write_exit(request: EvidenceRequest, exit: EvidenceExit): Promise<boolean> {
	return (await post_evidence(request)) && (await exit.finish(request.issue_number))
}

async function is_admitted(request: EvidenceRequest, exit: EvidenceExit): Promise<boolean> {
	return exit.admit === undefined || (await exit.admit(request.issue_number))
}

async function run(argv: ReadonlyArray<string>, exit: EvidenceExit): Promise<number> {
	const request = resolve_request(argv, exit.command)
	if (request === undefined || !(await is_admitted(request, exit))) return FAILURE_EXIT_CODE

	return (await write_exit(request, exit))
		? await run_hold_cli.run(['--release', request.issue_number])
		: FAILURE_EXIT_CODE
}

// The writes alone, for evidence composed in process — `backlog:drive`'s measured close
// (`backlog-measure-close.ts`), which holds no tree of the issue's, so there is nothing to release.
const issue_evidence_exit = { run, write: write_exit }

export type { EvidenceExit, EvidenceRequest }
export { issue_evidence_exit }
