import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { MergeResult } from './run-merge-cli'
import { run_merge_outcome } from './run-merge-outcome'
import { run_merge_token } from './run-merge-token'

// `run:merge` as `backlog:drive` runs it: a child process per merge, never an import, so a fix merged
// into `run:merge` after the driver started is the code its next merge runs (joshuafolkken/kit#4102).
// Imported in process, the driver went on parking children with the code it was started with.
//
// `--driver` asks for what the driver alone needs: no hand-off threshold — a supervisor has no context
// to cut — and the whole `MergeResult` as one JSON line on stdout's last line, since the outcome the
// driver branches on is not in the token a person reads.

const COMMAND = 'run:merge'
const DRIVER_FLAG = '--driver'
const JSON_KEY = 'merge'
const LINE_BREAK = '\n'
// The offer token `--driver` answers in place of `backlog:next`'s: the driver never reads an offer's
// text, only that one was printed, and asks `backlog:offer` itself (joshuafolkken/kit#4406).
const DEFERRED_OFFER = 'deferred'

const control_schema = z.object({
	token: z.enum(Object.values(run_merge_token.MERGE_TOKEN)),
	code: z.number(),
	is_offer: z.literal(false),
	outcome: z.enum(run_merge_outcome.CHILD_OUTCOMES),
})
const offer_schema = z.object({
	token: z.string(),
	code: z.number(),
	is_offer: z.literal(true),
	outcome: z.enum(run_merge_outcome.CHILD_OUTCOMES),
})
const printed_schema = z.object({
	[JSON_KEY]: z.discriminatedUnion('is_offer', [control_schema, offer_schema]),
})

interface DriverMerge {
	child: string
	owner: string
	output: string | undefined
}

function argv_of(merge: DriverMerge): Array<string> {
	const output = merge.output === undefined ? [] : ['--output', merge.output]

	return [COMMAND, merge.child, '--owner', merge.owner, DRIVER_FLAG, ...output]
}

function print(result: MergeResult): string {
	return JSON.stringify({ [JSON_KEY]: result })
}

// What `run:merge` prints: the whole result under `--driver`, else the token a person reads.
function printed(argv: ReadonlyArray<string>, result: MergeResult): string {
	return argv.includes(DRIVER_FLAG) ? print(result) : result.token
}

// The result on stdout's last line, or `undefined` where the child process printed none — a crash
// before its verdict, which the driver reads as no token.
function read(out: string): MergeResult | undefined {
	const last = out.trimEnd().split(LINE_BREAK).at(-1) ?? ''

	return json_value.parse_with(last, printed_schema)?.[JSON_KEY]
}

const run_merge_driver = { DEFERRED_OFFER, DRIVER_FLAG, argv_of, print, printed, read }

export type { DriverMerge }
export { run_merge_driver }
