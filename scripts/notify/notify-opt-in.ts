import type { TelegramTaskType } from './telegram-notify'

// **`planning` and `completion` reach a person only when they asked for them.** Neither needs the
// person to act now — a plan is posted on the Issue and a merge is visible on the pull request — so
// sending both on every run buried the types that do need someone. Every other type is unaffected.
//
// **One variable listing the opted-in types, not one switch per type**, so making a further type
// optional later adds an entry to `OPTIONAL_TASK_TYPES` rather than another variable.
const OPT_IN_KEY = 'JOSH_NOTIFY_OPT_IN'
const OPTIONAL_TASK_TYPES: ReadonlySet<TelegramTaskType> = new Set(['planning', 'completion'])
const LIST_SEPARATOR = ','

function opted_in_types(): ReadonlyArray<string> {
	return (process.env[OPT_IN_KEY] ?? '')
		.split(LIST_SEPARATOR)
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0)
}

// Unset means none: an optional type is sent only once it is named.
function is_skipped(task_type: TelegramTaskType): boolean {
	if (!OPTIONAL_TASK_TYPES.has(task_type)) return false

	return !opted_in_types().includes(task_type)
}

function skip_line(task_type: TelegramTaskType): string {
	return `🔕 ${task_type} notifications are not opted in (${OPT_IN_KEY}).`
}

const notify_opt_in = { is_skipped, skip_line }

export { notify_opt_in }
