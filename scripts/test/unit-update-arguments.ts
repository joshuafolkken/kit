import type { SnapshotUpdateState } from 'vitest'

// vitest's `-u` / `--update` takes an optional value (`argument: "[type]"` in its CLI definition), so
// the bare word after it is read as the update type, never as a file filter: `josh test:unit -u
// run-transcript` ran the whole suite (joshuafolkken/kit#5383). A word that is no update type is
// therefore moved in front of the flag, where vitest reads it as the filter it was meant to be.
//
// **The keys are written here because vitest exports the accepted types only as the
// `SnapshotUpdateState` type**, with no runtime list; the `Record` makes the compiler refuse a key
// vitest drops or a type it adds. `true` / `false` are the boolean the option's description accepts.
const UPDATE_VALUES: Record<SnapshotUpdateState | `${boolean}`, true> = {
	all: true,
	new: true,
	none: true,
	true: true,
	false: true,
}
const UPDATE_FLAGS: ReadonlySet<string> = new Set(['-u', '--update'])
const OPTION_PREFIX = '-'
const NOT_FOUND = -1

interface UpdateReorder {
	arguments: ReadonlyArray<string>
	filter?: string
}

function is_filter_word(value: string | undefined): value is string {
	if (value === undefined || value.startsWith(OPTION_PREFIX)) return false

	return !Object.hasOwn(UPDATE_VALUES, value)
}

function reorder(vitest_arguments: ReadonlyArray<string>): UpdateReorder {
	const flag_index = vitest_arguments.findIndex((argument) => UPDATE_FLAGS.has(argument))
	const value = flag_index === NOT_FOUND ? undefined : vitest_arguments[flag_index + 1]

	if (!is_filter_word(value)) return { arguments: vitest_arguments }

	const without_value = vitest_arguments.toSpliced(flag_index + 1, 1)

	return { arguments: without_value.toSpliced(flag_index, 0, value), filter: value }
}

function notice(filter: string): string {
	return `moved "${filter}" in front of the update flag — vitest reads the word after it as the update type, not a file filter.`
}

const unit_update_arguments = {
	notice,
	reorder,
}

export type { UpdateReorder }
export { unit_update_arguments }
