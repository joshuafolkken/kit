import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { run_hold, type RunMark } from './run-hold'

// What `josh run:hold` / `josh run:release` asked for, read from its argv (`run-hold-cli.ts`).

const RELEASE_FLAG = '--release'
// What removes a record this run did not write. **Deliberate friction**: every release names the run
// it belongs to, and the one act that cannot — clearing a record somebody else left behind — is
// spelled out rather than reached by typing the ordinary command.
const FORCE_FLAG = '--force'
// What `fullrun #N`'s entry claims with, so the record says the run is a `fullrun` — the one run whose
// implementation cut outside a lane resumes as `fullrun #N`.
const FULLRUN_FLAG = '--fullrun'
// What `prrun #N`'s entry claims with: a `fullrun`'s record that `run:board` names `prrun`.
const PRRUN_FLAG = '--prrun'
const HALFRUN_STOP_FLAG = '--halfrun-stop'
// A `halfrun` fix round's start: the stopped record re-opened as the round's (`run-halfrun-resume.ts`).
const HALFRUN_ROUND_FLAG = '--halfrun-round'
// A `prrun`'s stop before merge: its record keeps the commit it stopped on.
const PRRUN_STOP_FLAG = '--prrun-stop'
// A `needs-human-review` stop: marked as a `halfrun` stop is, with its own confirmation.
const HUMAN_REVIEW_STOP_FLAG = '--human-review-stop'
// A `new` run's hand-over of its unnumbered record to the Issue it filed (`run-hold-adopt.ts`).
const ADOPT_FLAG = '--adopt'
// The most a claim reads: the issue number and the one flag after it.
const MAX_CLAIM_ARGUMENTS = 2
const USAGE =
	'Usage: josh run:hold [<issue-number> [--fullrun | --prrun | --halfrun-stop | --halfrun-round | --human-review-stop | --prrun-stop]] | josh run:hold --adopt <issue-number> | josh run:release [<issue-number> | --force]'

const FORCE_RELEASE_KIND = 'force-release'
const HALFRUN_STOP_KIND = 'halfrun-stop'
const HUMAN_REVIEW_STOP_KIND = 'human-review-stop'
const PRRUN_STOP_KIND = 'prrun-stop'
const ADOPT_KIND = 'adopt'
const HALFRUN_ROUND_KIND = 'halfrun-round'

type StopKind = typeof HALFRUN_STOP_KIND | typeof HUMAN_REVIEW_STOP_KIND | typeof PRRUN_STOP_KIND

// The requests that take over a record this issue's own run left: `--adopt` and `--halfrun-round`.
interface TakeOverRequest {
	kind: typeof ADOPT_KIND | typeof HALFRUN_ROUND_KIND
	issue: string
}

interface ClaimRequest {
	kind: 'claim'
	issue: string
	mark?: RunMark
}

interface StopRequest {
	kind: StopKind
	issue: string
}

type HoldRequest =
	| ClaimRequest
	| StopRequest
	| TakeOverRequest
	| { kind: 'release'; claimant: string }
	| { kind: typeof FORCE_RELEASE_KIND }

const STOP_KINDS: ReadonlySet<string> = new Set([
	HALFRUN_STOP_KIND,
	HUMAN_REVIEW_STOP_KIND,
	PRRUN_STOP_KIND,
])

function is_stop_request(request: HoldRequest): request is StopRequest {
	return STOP_KINDS.has(request.kind)
}

const TAKE_OVER_KINDS: ReadonlySet<string> = new Set([ADOPT_KIND, HALFRUN_ROUND_KIND])

function is_take_over_request(request: HoldRequest): request is TakeOverRequest {
	return TAKE_OVER_KINDS.has(request.kind)
}

const FORCE_RELEASE_REQUEST: HoldRequest = { kind: FORCE_RELEASE_KIND }

function release_request(claimant: string): HoldRequest {
	return { kind: 'release', claimant }
}

const STOP_KIND_BY_FLAG: ReadonlyMap<string, StopKind> = new Map([
	[HALFRUN_STOP_FLAG, HALFRUN_STOP_KIND],
	[HUMAN_REVIEW_STOP_FLAG, HUMAN_REVIEW_STOP_KIND],
	[PRRUN_STOP_FLAG, PRRUN_STOP_KIND],
])

const CLAIM_MARK_BY_FLAG: ReadonlyMap<string, RunMark> = new Map([
	[FULLRUN_FLAG, run_hold.FULLRUN_MARK],
	[PRRUN_FLAG, run_hold.PRRUN_MARK],
])

// The flag after a numbered claim: absent, `--fullrun`, `--prrun`, `--halfrun-stop`,
// `--halfrun-round`, `--human-review-stop` or `--prrun-stop`. Anything else is a usage error.
function numbered_claim(issue: string, flag: string | undefined): HoldRequest | undefined {
	if (flag === undefined) return { kind: 'claim', issue }

	const stop_kind = STOP_KIND_BY_FLAG.get(flag)

	if (stop_kind !== undefined) return { kind: stop_kind, issue }

	if (flag === HALFRUN_ROUND_FLAG) return { kind: HALFRUN_ROUND_KIND, issue }

	const mark = CLAIM_MARK_BY_FLAG.get(flag)

	return mark === undefined ? undefined : { kind: 'claim', issue, mark }
}

function parse_claim(argv: ReadonlyArray<string>): HoldRequest | undefined {
	const [first, flag] = argv

	if (first === undefined) return { kind: 'claim', issue: run_hold.UNNUMBERED_ISSUE }

	if (argv.length > MAX_CLAIM_ARGUMENTS || !issue_number_shape.ISSUE_NUMBER_PATTERN.test(first)) {
		return undefined
	}

	return numbered_claim(first, flag)
}

function parse_release_argument(first: string): HoldRequest | undefined {
	if (first === FORCE_FLAG) return FORCE_RELEASE_REQUEST

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(first) ? release_request(first) : undefined
}

// **A bare `run:release` is the unnumbered run's release, not a release of whatever is there.** It
// mirrors the bare claim, which records `new`, so the two spellings stay one pair.
function parse_release(argv: ReadonlyArray<string>): HoldRequest | undefined {
	const [first] = argv

	if (first === undefined) return release_request(run_hold.UNNUMBERED_ISSUE)

	return argv.length > 1 ? undefined : parse_release_argument(first)
}

function parse_adopt(argv: ReadonlyArray<string>): HoldRequest | undefined {
	const [issue] = argv

	if (issue === undefined || argv.length > 1) return undefined

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(issue)
		? { kind: ADOPT_KIND, issue }
		: undefined
}

function parse_request(argv: ReadonlyArray<string>): HoldRequest | undefined {
	if (argv[0] === RELEASE_FLAG) return parse_release(argv.slice(1))

	if (argv[0] === ADOPT_FLAG) return parse_adopt(argv.slice(1))

	return parse_claim(argv)
}

const run_hold_request = {
	ADOPT_KIND,
	FORCE_FLAG,
	FORCE_RELEASE_KIND,
	HALFRUN_STOP_KIND,
	HUMAN_REVIEW_STOP_KIND,
	PRRUN_STOP_KIND,
	RELEASE_FLAG,
	USAGE,
	is_stop_request,
	is_take_over_request,
	parse_request,
} as const

export { run_hold_request }
export type { ClaimRequest, HoldRequest, StopKind, StopRequest, TakeOverRequest }
