import type { MergeContext } from './run-merge-steps'

// The moment the stub confirms the merge — the date the record is put on.
const CONFIRMED_AT = new Date('2026-10-24T00:00:00.000Z')

// `run_merge_steps.do_merged` as a `run:merge` test stubs it: the merge is put on record through the
// recorder the caller hands it, dated to the ownership check as the real step does, and nothing else
// runs.
async function record_merged(
	ctx: MergeContext,
	record: (child: string, at: Date) => Promise<void>,
): Promise<undefined> {
	await record(ctx.child, CONFIRMED_AT)

	return undefined
}

const run_merge_steps_fixture = { CONFIRMED_AT, record_merged }

export { run_merge_steps_fixture }
