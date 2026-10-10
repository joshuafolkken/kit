import { stamp_file } from '#scripts/josh/stamp-file'
import type { RunCarry } from './run-carry'

// A named `backlogrun #N` run, with or without `--only`, derives its named list from the `invocation`
// string. **The invocation is not rewritten** to add an issue mid-run — `classify_claim` compares it
// character for character to decide who owns the record, so an edited invocation would answer
// `mismatch` at the next resume. The additions are kept beside it,
// each marked with whether it jumps the queue (`pnpm josh run:add`) or joins its end
// (`--no-priority`), and `remaining_of` folds them into the one ordered list the run reads.
interface CarryAddition {
	issue: number
	is_priority: boolean
}

function issues_of(
	added: ReadonlyArray<CarryAddition>,
	is_priority: boolean,
): ReadonlyArray<number> {
	return added.filter((entry) => entry.is_priority === is_priority).map((entry) => entry.issue)
}

// The prioritized additions first, in the order they were added, then the declared list, then the
// appended additions — each issue once, at its first position.
function ordered(
	declared: ReadonlyArray<number>,
	added: ReadonlyArray<CarryAddition> = [],
): ReadonlyArray<number> {
	const sequence = [...issues_of(added, true), ...declared, ...issues_of(added, false)]

	return sequence.filter((issue, index) => sequence.indexOf(issue) === index)
}

// An issue already added keeps its first entry, so a repeated `run:add` cannot reorder the queue.
function next_added(
	carry: RunCarry,
	additions: ReadonlyArray<CarryAddition>,
): Array<CarryAddition> {
	const next = [...(carry.added ?? [])]

	for (const addition of additions) {
		if (next.every((entry) => entry.issue !== addition.issue)) next.push(addition)
	}

	return next
}

function add_issues(
	target: string,
	carry: RunCarry,
	additions: ReadonlyArray<CarryAddition>,
): RunCarry {
	const next: RunCarry = { ...carry, added: next_added(carry, additions) }

	stamp_file.write_stamp(target, next)

	return next
}

const run_carry_added = { add_issues, ordered }

export type { CarryAddition }
export { run_carry_added }
