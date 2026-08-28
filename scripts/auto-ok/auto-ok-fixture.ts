import { AUTO_OK_LABEL } from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'

// Fixtures shared by the `auto-ok:next` suites. Split out when the pickup gained its dependency
// check and the tests outgrew one file (joshuafolkken/kit#996) — a second copy of these builders is
// the clone `CLAUDE.md` prohibits, and a listing row built two ways is exactly what stops pinning
// the behavior it was written for.

const CREATED_EARLIER = '2026-08-01T00:00:00Z'
const CREATED_LATER = '2026-08-02T00:00:00Z'
const OLD_ISSUE_NUMBER = 700
const NEW_ISSUE_NUMBER = 900
const BLOCKER_NUMBER = 500
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const IN_PROGRESS_SPELLING = 'in-progress'
const OPEN_SPELLING = 'OPEN'
const CLOSED_SPELLING = 'CLOSED'

function issue(
	number: number,
	created_at: string,
	labels: ReadonlyArray<string> = [AUTO_OK_LABEL],
): OpenIssueData {
	return {
		number,
		title: `issue ${String(number)}`,
		createdAt: created_at,
		labels: labels.map((name) => ({ name })),
	}
}

// The same issue, declaring blockers. `gh` returns each blocker's state beside its number, which is
// what lets the pickup tell a resolved prerequisite from a standing one. The state is optional here
// because a blocker reported without one must read as still standing.
function blocked_issue(
	number: number,
	created_at: string,
	blockers: ReadonlyArray<{ number: number; state?: string }>,
): OpenIssueData {
	return { ...issue(number, created_at), blockedBy: { nodes: [...blockers] } }
}

// A listing exactly at the cap, so the truncation notice fires.
function capped_listing(limit: number, labels: ReadonlyArray<string>): string {
	return JSON.stringify(
		Array.from({ length: limit }, (_value, index) => issue(index + 1, CREATED_EARLIER, labels)),
	)
}

// Captures a console stream as text rather than reading it off the spy, which types its calls as
// `any`. Shared because both suites assert on the same two streams.
function record(lines: Array<string>): (...args: Array<unknown>) => void {
	return (...args: Array<unknown>): void => {
		lines.push(args.map(String).join(' '))
	}
}

const auto_ok_fixture = { issue, blocked_issue, capped_listing, record }

export {
	auto_ok_fixture,
	BLOCKER_NUMBER,
	CLOSED_SPELLING,
	CREATED_EARLIER,
	CREATED_LATER,
	FAILURE_EXIT_CODE,
	IN_PROGRESS_SPELLING,
	NEW_ISSUE_NUMBER,
	OLD_ISSUE_NUMBER,
	OPEN_SPELLING,
	SUCCESS_EXIT_CODE,
}
