import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { run_cut, type CutState } from './run-cut'

// The implementation cut a run asked for and was refused — `not-a-lane` or `unready` — recorded so the
// implementation-cut guard stops asking for it (joshuafolkken/kit#3881).
//
// **The reissue window alone re-asked every 90 seconds.** A run whose `run:cut --impl` can only answer
// `unready` was refused edit after edit, each refusal a round trip that cut nothing. Neither answer
// changes while the same hold stands over the tree, so the record names the issue and the hold it
// answered, and the guard stays silent while both still match; a fresh hold — a new run — asks again.

const DECLINE_PREFIX = 'josh-run-cut-decline-'

const decline_schema = z.object({ issue: z.string(), hold_taken_at: z.string().optional() })

type CutDecline = z.infer<typeof decline_schema>

function decline_path(git_directory: string): string {
	return stamp_file.stamp_path(DECLINE_PREFIX, git_directory)
}

function record(git_directory: string, decline: CutDecline): void {
	stamp_file.replace_stamp(decline_path(git_directory), decline)
}

function read(git_directory: string): CutDecline | undefined {
	const raw = stamp_file.read_stamp_text(decline_path(git_directory))

	return raw === undefined ? undefined : json_value.parse_with(raw, decline_schema)
}

function matches(recorded: CutDecline | undefined, current: CutDecline): boolean {
	return recorded?.issue === current.issue && recorded.hold_taken_at === current.hold_taken_at
}

// The same read taken synchronously, for the `PreToolUse` guard. A checkout git cannot describe has no
// record, so the guard keeps speaking there.
function is_declined_sync(
	issue: string,
	directory: string | undefined = run_cut.worktree_git_directory_sync(),
): boolean {
	if (directory === undefined) return false

	const hold_taken_at = run_cut.hold_of(directory)?.taken_at

	return matches(read(directory), { issue, hold_taken_at })
}

// **An implementation cut `run:cut` refuses is recorded for the guard that asked for it**, then its
// exit code is passed back unchanged. The pre-gate phase has its own guard and records nothing.
async function declined(
	request: { issue: string; phase: string },
	state: CutState,
	code: number,
): Promise<number> {
	if (request.phase !== run_cut.IMPLEMENTATION_PHASE) return code

	const directory = await run_cut.worktree_directory()

	if (directory !== undefined) {
		record(directory, { issue: request.issue, hold_taken_at: state.hold_taken_at })
	}

	return code
}

const run_cut_decline = { decline_path, declined, is_declined_sync, read, record }

export type { CutDecline }
export { run_cut_decline }
