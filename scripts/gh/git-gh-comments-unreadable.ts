// A pull request comment listing that could not be read (joshuafolkken/kit#5012).
//
// The reader warns with gh's reason, never swallowing it. Only the AI review gate stops on the
// unreadable listing — a CodeRabbit listing that could not be read is a note the followup carries
// past — so the gate alone prints `UNREADABLE_COMMENTS_STOP` on the standard output, which `josh ship`
// reads as the infrastructure and re-runs the followup on in place rather than relaunching the lane.
// Its own module, so the ship's stop classification reads the note without loading the gate.

const UNREADABLE_COMMENTS_STOP = 'the merge gate stopped on reviewer comments it could not read'

// Set by `josh ship` around an attempt it will run again on an infrastructure stop
// (`run-ship-infra-retry.ts`): the gate's `confirmation` then waits for the final attempt, so a read
// that recovers sends none and one that never does sends one.
const RETRY_PENDING_KEY = 'JOSH_SHIP_RETRY_PENDING'
const RETRY_PENDING_VALUE = '1'

function note_unreadable_comments(branch_name: string, reason: string): void {
	console.warn(`⚠ pull request comments could not be read for ${branch_name}: ${reason}`)
}

function note_unreadable_stop(): void {
	console.info(`⚠️ ${UNREADABLE_COMMENTS_STOP}`)
}

function is_retry_pending(): boolean {
	return process.env[RETRY_PENDING_KEY] === RETRY_PENDING_VALUE
}

export {
	is_retry_pending,
	note_unreadable_comments,
	note_unreadable_stop,
	RETRY_PENDING_KEY,
	RETRY_PENDING_VALUE,
	UNREADABLE_COMMENTS_STOP,
}
