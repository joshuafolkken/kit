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

function filter_words(vitest_arguments: ReadonlyArray<string>): ReadonlyArray<string> {
	const next_option = vitest_arguments.findIndex((argument) => argument.startsWith(OPTION_PREFIX))

	return next_option === NOT_FOUND ? vitest_arguments : vitest_arguments.slice(0, next_option)
}

function filter_flag(vitest_arguments: ReadonlyArray<string>): number {
	const delimiter = vitest_arguments.indexOf('--')
	const options = delimiter === NOT_FOUND ? vitest_arguments : vitest_arguments.slice(0, delimiter)

	return options.findIndex(
		(argument, index) => UPDATE_FLAGS.has(argument) && is_filter_word(options[index + 1]),
	)
}

function reorder(vitest_arguments: ReadonlyArray<string>): UpdateReorder {
	const flag_index = filter_flag(vitest_arguments)
	const value = flag_index === NOT_FOUND ? undefined : vitest_arguments[flag_index + 1]

	if (!is_filter_word(value)) return { arguments: vitest_arguments }

	const filters = filter_words(vitest_arguments.slice(flag_index + 1))
	const ordered = vitest_arguments.toSpliced(flag_index + 1, filters.length)

	return {
		arguments: reorder(ordered.toSpliced(flag_index, 0, ...filters)).arguments,
		filter: value,
	}
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
