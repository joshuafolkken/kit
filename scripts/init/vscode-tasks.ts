import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { patch_json_array } from '#scripts/config-merge/patch-json-array'
import { json_object_schema } from '#scripts/lib/schemas'
import { z } from 'zod'
import { init_logic_json_merge } from './init-logic-json-merge'

type Task = Record<string, unknown>

const TASKS_KEY = 'tasks'
const LABEL_KEY = 'label'
const TASKS_VERSION = '2.0.0'
const VSCODE_TASKS_FILENAME = 'tasks.json'

// A label kit once shipped a task under, mapped to the label that replaced it. A consumer's task still
// carrying the retired label is the same kit task under its old name, so it is replaced in place — an
// append would leave the retired folder-open pane starting beside its successor.
const RETIRED_LABELS: ReadonlyMap<unknown, string> = new Map([
	['josh: run event watch', 'josh: run board'],
])

const task_array_schema = z.array(json_object_schema)

function read_tasks(parsed: Record<string, unknown>): Array<Task> {
	const result = task_array_schema.safeParse(parsed[TASKS_KEY])

	return result.success ? result.data : []
}

// A task is identified by its `label` — the name VSCode runs it by and `dependsOn` refers to it by.
function has_label(element: unknown, label: unknown): boolean {
	const result = json_object_schema.safeParse(element)
	if (!result.success) return false
	const own = result.data[LABEL_KEY]

	return (RETIRED_LABELS.get(own) ?? own) === label
}

// Kit owns the tasks whose label it ships: each is replaced with kit's current definition in place,
// a kit task the file lacks is appended, and every other task the consumer declared is kept as
// authored, comments included — the label-level counterpart of the key-level merge
// `.vscode/settings.json` gets.
function merge_tasks(content: string, kit_tasks: ReadonlyArray<Task>): string {
	let merged = init_logic_json_merge.merge_json_object(content, { version: TASKS_VERSION })

	for (const task of kit_tasks) {
		merged = patch_json_array.upsert_element(merged, {
			key: TASKS_KEY,
			value: task,
			is_target: (element) => has_label(element, task[LABEL_KEY]),
		})
	}

	return merged
}

function read_kit_tasks(content: string): Array<Task> {
	return read_tasks(parse_jsonc(content))
}

const vscode_tasks = { VSCODE_TASKS_FILENAME, merge_tasks, read_kit_tasks }

export { vscode_tasks }
