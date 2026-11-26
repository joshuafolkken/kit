import { EPIC_LABEL, has_label_name, has_parked_label } from '#scripts/issue/issue-labels'
import type { IssueState } from '#scripts/issue/issue-state'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_blocked } from './backlog-drive-blocked'
import { backlog_drive_epic } from './backlog-drive-epic'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_named_gate, type NamedPlain } from './backlog-drive-named-gate'
import { backlog_drive_rate_limit } from './backlog-drive-rate-limit'
import { backlog_drive_unread } from './backlog-drive-unread'

interface Launched {
	offered: OfferRead
	plain?: NamedPlain
}

interface Walk {
	runs: Array<string>
	plain: Array<NamedPlain>
	passed: Array<string>
	stop: OfferRead | undefined
}

interface Gathered {
	offer: OfferRead | undefined
	passed: ReadonlyArray<string>
}

const NO_RETRIES = 0
const WAIT: OfferRead = { verdict: 'wait', issues: [], retries: NO_RETRIES }

// Whether a named issue has already settled without this run dispatching it: closed is merged, and a
// park (`PARKED_LABELS`) waits on a person, so re-dispatching it only repeats the stop it parked on.
// Either is booked done rather than offered.
function is_settled(state: IssueState): boolean {
	return state.state.toUpperCase() === 'CLOSED' || has_parked_label(state.labels)
}

function plain_of(issue: string, state: IssueState): Launched {
	return {
		offered: { verdict: 'run', issues: [issue], retries: NO_RETRIES },
		plain: { number: Number(issue), labels: state.labels },
	}
}

async function classify(issue: string, state: DriveState, owner: string): Promise<Launched> {
	const result = await issue_state_cli.read_issue(issue)

	if (result.kind !== 'state') {
		return { offered: backlog_drive_unread.offer(issue, result, state.retries) }
	}

	if (is_settled(result.state)) {
		await backlog_drive_named.mark_settled(issue, owner)

		return { offered: WAIT }
	}

	if (!has_label_name(result.state.labels, EPIC_LABEL)) return plain_of(issue, result.state)

	return { offered: await backlog_drive_epic.offer(issue, state, owner) }
}

// A named issue whose blockers are unfinished waits (`backlog-drive-blocked.ts`).
async function launch(issue: string, state: DriveState, owner: string): Promise<Launched> {
	const launched = await classify(issue, state, owner)
	const offered = await backlog_drive_blocked.gate(issue, launched.offered)

	return offered === launched.offered ? launched : { offered: WAIT }
}

// A named issue that waits with no retry owed holds nothing up (joshuafolkken/kit#6883,
// joshuafolkken/kit#8953): an epic waiting on its children, one settled before the run dispatched it, or
// one whose blockers are unfinished is passed, and the issues behind it fill the free lanes. The pool
// counts a passed one running, so with no lane of the run's own in flight it does not read the drain.
// A failed read still waits (`retries`), so the issue's retry count reaches its hand-back.
function is_passed(offered: OfferRead): boolean {
	return offered.verdict === 'wait' && offered.retries === NO_RETRIES
}

function record_wait(walked: Walk, issue: string, offered: OfferRead): boolean {
	if (!is_passed(offered)) {
		walked.stop = offered

		return false
	}

	walked.passed.push(issue)

	return true
}

function record(walked: Walk, issue: string, launched: Launched): boolean {
	const { offered, plain } = launched
	if (offered.verdict !== 'run') return record_wait(walked, issue, offered)

	walked.runs.push(...offered.issues)
	if (plain !== undefined) walked.plain.push(plain)

	return true
}

async function walk(
	issues: ReadonlyArray<string>,
	state: DriveState,
	owner: string,
): Promise<Walk> {
	const walked: Walk = { runs: [], plain: [], passed: [], stop: undefined }

	for (const issue of issues) {
		const seen = { ...state, in_flight: [...state.in_flight, ...walked.runs] }
		// eslint-disable-next-line no-await-in-loop -- an epic's child offer reads the runs gathered before it
		const launched = await launch(issue, seen, owner)

		if (!record(walked, issue, launched)) break
	}

	return walked
}

async function withheld_of(walked: Walk, in_flight: ReadonlyArray<string>): Promise<Array<string>> {
	const admitted = await backlog_drive_named_gate.admitted(walked.plain, in_flight)
	const withheld = walked.plain.filter((issue) => !admitted.includes(issue.number))

	return withheld.map((issue) => String(issue.number))
}

// **Every named issue left is offered at once, in the typed order** (joshuafolkken/kit#8953); the free
// lanes take them in that order (`backlog_drive_seats.seated`). A launch waits for the reset while the
// GitHub core allowance is below the floor, before it reads any state (joshuafolkken/kit#6729). A named
// issue the solo hold or the overlap separation withholds waits for the next tick, as the pool's does.
async function gather(
	issues: ReadonlyArray<string>,
	state: DriveState,
	owner: string,
): Promise<Gathered> {
	const held = await backlog_drive_rate_limit.held(state)
	if (held !== undefined) return { offer: held, passed: [] }
	const walked = await walk(issues, state, owner)
	const withheld = await withheld_of(walked, state.in_flight)
	const runs = walked.runs.filter((issue) => !withheld.includes(issue))

	if (runs.length > 0) {
		return { offer: { verdict: 'run', issues: runs, retries: NO_RETRIES }, passed: walked.passed }
	}

	return { offer: walked.stop ?? (withheld.length > 0 ? WAIT : undefined), passed: walked.passed }
}

export const backlog_drive_named_launch = { gather }
