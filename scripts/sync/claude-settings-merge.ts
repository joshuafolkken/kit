import { json_format } from '#scripts/config-merge/json-format'
import { hook_command_rewrite } from '#scripts/init/hook-command-rewrite'
import { json_value } from '#scripts/lib/json-value'

// `josh sync` used to replace a project's `.claude/settings.json` with the distributed file, which
// deleted every hook and permission the project had added — and `.claude/settings.local.json` is
// personal, so a team had nowhere to keep a shared one. The merge replaces what kit ships and keeps
// the rest:
//
//  - hooks: a handler whose command has one of kit's shapes is kit's — the current ones are replaced
//    and a retired one is dropped; every other handler is the project's and stays.
//  - permissions: kit's `allow` / `deny` entries are always present, so a removed `deny` comes back;
//    the project's own entries follow them, less the ones kit has withdrawn.
//  - any other key: kit's value where kit ships one, the project's where it does not. Objects merge
//    entry by entry, so a project's own `env` variable or plugin survives beside kit's.
//
// kit's keys and entries come first and in kit's order, which is what makes a file with nothing of the
// project's own come out byte-identical to the distributed one, and a second merge change nothing.

type JsonObject = Record<string, unknown>
type EntryMerge = (key: string, kit: unknown, own: unknown) => unknown

const HOOKS_KEY = 'hooks'
const PERMISSIONS_KEY = 'permissions'
// An entry kit stops shipping would otherwise stay in every merged file as if the project had added
// it, so a permission kit withdraws could never be withdrawn. Withdrawing one means removing it from
// kit's settings file and naming it here.
const WITHDRAWN_KIT_PERMISSIONS: ReadonlySet<unknown> = new Set([
	'Bash(git commit -a*)',
	'Bash(git commit --all*)',
])

function as_array(value: unknown): Array<unknown> {
	return Array.isArray(value) ? value : []
}

function merge_objects(kit: JsonObject, own: JsonObject, merge_entry: EntryMerge): JsonObject {
	const merged: JsonObject = { ...kit, ...own }

	for (const [key, value] of Object.entries(kit)) merged[key] = merge_entry(key, value, own[key])

	return merged
}

function merge_kit_value(kit: unknown, own: unknown): unknown {
	if (!json_value.is_record(kit) || !json_value.is_record(own)) return kit

	return merge_objects(kit, own, (_key, kit_entry, own_entry) =>
		merge_kit_value(kit_entry, own_entry),
	)
}

function merge_permission(kit: unknown, own: unknown): unknown {
	if (!Array.isArray(kit) || !Array.isArray(own)) return merge_kit_value(kit, own)

	return [...new Set([...as_array(kit), ...as_array(own)])]
}

function without_withdrawn(value: unknown): unknown {
	if (!Array.isArray(value)) return value

	return value.filter((entry) => !WITHDRAWN_KIT_PERMISSIONS.has(entry))
}

// The withdrawn entries are taken out of every list first, so one goes even when kit no longer ships
// the list it sat in.
function merge_permissions(kit: unknown, own: unknown): unknown {
	if (!json_value.is_record(kit) || !json_value.is_record(own)) return kit
	const kept = Object.entries(own).map(([key, value]) => [key, without_withdrawn(value)] as const)

	return merge_objects(kit, Object.fromEntries(kept), (_key, kit_entry, own_entry) =>
		merge_permission(kit_entry, own_entry),
	)
}

function is_kit_handler(handler: unknown): boolean {
	if (!json_value.is_record(handler)) return false
	const { command } = handler

	return typeof command === 'string' && hook_command_rewrite.is_kit_hook_command(command)
}

// A matcher group left with no handler of the project's own was kit's alone, and goes with them.
function without_kit_handlers(group: unknown): unknown {
	if (!json_value.is_record(group)) return group
	const handlers = as_array(group[HOOKS_KEY]).filter((handler) => !is_kit_handler(handler))

	return handlers.length === 0 ? undefined : { ...group, [HOOKS_KEY]: handlers }
}

function own_groups(groups: unknown): Array<unknown> {
	return as_array(groups)
		.map((group) => without_kit_handlers(group))
		.filter((group) => group !== undefined)
}

function own_hook_events(own: JsonObject): JsonObject {
	const events = Object.entries(own).map(([event, groups]) => [event, own_groups(groups)] as const)

	return Object.fromEntries(events.filter(([, groups]) => groups.length > 0))
}

function merge_hooks(kit: unknown, own: unknown): unknown {
	if (!json_value.is_record(kit) || !json_value.is_record(own)) return kit

	return merge_objects(kit, own_hook_events(own), (_event, kit_groups, groups) => [
		...as_array(kit_groups),
		...as_array(groups),
	])
}

function merge_top_level(key: string, kit: unknown, own: unknown): unknown {
	if (key === HOOKS_KEY) return merge_hooks(kit, own)
	if (key === PERMISSIONS_KEY) return merge_permissions(kit, own)

	return merge_kit_value(kit, own)
}

function parse_object(content: string): JsonObject | undefined {
	const parsed = json_value.parse_or_undefined(content)

	return json_value.is_record(parsed) ? parsed : undefined
}

// A file that does not parse as a JSON object has nothing the merge can keep, so it is replaced with
// the distributed one, as every file was before the merge existed.
function merge_claude_settings(existing: string, distributed: string): string {
	const own = parse_object(existing)
	const kit = parse_object(distributed)
	if (own === undefined || kit === undefined) return distributed

	return json_format.format_json(merge_objects(kit, own, merge_top_level))
}

const claude_settings_merge = { merge_claude_settings, WITHDRAWN_KIT_PERMISSIONS }

export { claude_settings_merge }
