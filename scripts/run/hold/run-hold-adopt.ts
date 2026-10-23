import { stamp_file } from '#scripts/josh/stamp-file'
import { run_halfrun_resume } from '#scripts/run/run-halfrun-resume'
import { run_label } from '#scripts/run/run-label'
import { run_hold } from './run-hold'

// `josh run:hold --adopt <N>` — a `new` run's hand-over once its Issue is filed (joshuafolkken/kit#4156).
// The unnumbered record is re-keyed in place to `<N>`, so every later stop of the run releases with
// `run:release <N>` and that release takes `in-progress` back off; the adopt applies the label the
// numbered entry would have. **In place, not released and re-claimed**: a release would free the tree
// for a moment another session could claim it in, and the record's owner and stop marks stay as written.

const ADOPTED = 'adopted'
// The tree holds no record, so there is nothing to hand over.
const NO_RECORD = 'none'
const FOREIGN = 'foreign'
const UNREADABLE = 'unreadable'

type AdoptResult = typeof ADOPTED | typeof FOREIGN | typeof NO_RECORD | typeof UNREADABLE

// The record re-keyed: the unnumbered run's own, or one already naming `<N>` — a repeated adopt is
// the same hand-over, so it answers alike. Another issue's record is never touched.
function rekey(target: string, issue: string): AdoptResult {
	const read = run_hold.read_hold(target)

	if (read.kind === 'unreadable') return UNREADABLE

	const hold = run_halfrun_resume.hold_of(read)

	if (hold === undefined) return NO_RECORD

	if (hold.issue !== run_hold.UNNUMBERED_ISSUE && hold.issue !== issue) return FOREIGN

	stamp_file.write_stamp(target, { ...hold, issue })

	return ADOPTED
}

function no_record_message(issue: string): string {
	return `run:hold --adopt: this tree holds no record to adopt — claim it with \`pnpm josh run:hold ${issue}\`.`
}

// Not the claim race's message: that one advises `--force`, which here would free another run's tree.
function foreign_message(issue: string): string {
	return `run:hold --adopt: this tree is held for another issue, so it is not handed to issue ${issue}; \`--adopt\` only re-keys a \`new\` run's unnumbered record.`
}

async function adopt(target: string, issue: string): Promise<AdoptResult> {
	const result = rekey(target, issue)

	if (result === ADOPTED) await run_label.mark(issue)

	return result
}

const run_hold_adopt = {
	ADOPTED,
	NO_RECORD,
	UNREADABLE,
	adopt,
	foreign_message,
	no_record_message,
}

export type { AdoptResult }
export { run_hold_adopt }
