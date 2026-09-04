import path from 'node:path'
import { PROJECT_SCOPE, STAGED_SCOPE, type LayerStep } from './layer-step'
import { layer_yaml } from './layer-yaml'

// What the git hooks run, read from lefthook's own configuration (joshuafolkken/kit#1313).
//
// **`extends` is followed rather than ignored.** kit's `lefthook.yml` holds one kit-internal hook
// command and extends `lefthook/base.yml`, which holds the rest and is the file distributed to
// consumers. A reader that opened only one of the two would report half the pre-commit hook, and
// which half depends on which file it happened to pick.
//
// **The hook names are discovered, never listed.** Every top-level key carrying `commands` or
// `setup` is a layer, so a `post-merge` hook added tomorrow is read the day it lands.

const LEFTHOOK_ENTRY = 'lefthook.yml'
const EXTENDS_KEY = 'extends'
const COMMANDS_KEY = 'commands'
const JOBS_KEY = 'jobs'
const GROUP_KEY = 'group'
const SETUP_KEY = 'setup'
const RUN_KEY = 'run'
const NAME_KEY = 'name'
const SETUP_STEP = 'setup'
// The placeholders lefthook substitutes a **file list** into. A command carrying one sees only the
// files the hook handed it, never the tree; `{all_files}` is deliberately absent, because it is the
// whole project by definition. Their absence is what makes `tsc --noEmit` in the pre-commit hook a
// whole-project check despite sitting beside four that are not.
const FILE_LIST_TOKENS = ['{staged_files}', '{push_files}', '{files}']

interface HookDocument {
	path: string
	content: string
}

function scope_of(command: string): LayerStep['scope'] {
	return FILE_LIST_TOKENS.some((token) => command.includes(token)) ? STAGED_SCOPE : PROJECT_SCOPE
}

function command_step(layer: string, step: string, entry: unknown): LayerStep | undefined {
	const run = layer_yaml.as_string(layer_yaml.as_record(entry)?.[RUN_KEY])
	if (run === undefined) return undefined

	return { layer, step, command: run, scope: scope_of(run) }
}

function commands_of(layer: string, section: Record<string, unknown>): Array<LayerStep> {
	return layer_yaml
		.record_entries(section, COMMANDS_KEY)
		.map(([name, entry]) => command_step(layer, name, entry))
		.filter((step): step is LayerStep => step !== undefined)
}

// `setup` runs once before a hook's commands. It is a layer step like any other — kit's pre-push
// setup is a `pnpm install`, which is also a CI step, and a reader that skipped it would miss that.
function setup_of(layer: string, section: Record<string, unknown>): Array<LayerStep> {
	return (layer_yaml.as_array(section[SETUP_KEY]) ?? [])
		.map((entry) => command_step(layer, SETUP_STEP, entry))
		.filter((step): step is LayerStep => step !== undefined)
}

// lefthook 2's `jobs:` is a **list**, each entry either a command of its own or a `group` holding
// more of them. It is the modern spelling of `commands:` — a reader that knew only the legacy one
// would report a consumer's hook as empty and then claim its checks run in one layer fewer than
// they do, which is a false negative in the exact direction that gets work deleted.
function job_name(job: Record<string, unknown>, index: number): string {
	return layer_yaml.as_string(job[NAME_KEY]) ?? `${JOBS_KEY} ${String(index)}`
}

function nested_jobs(job: Record<string, unknown>): ReadonlyArray<unknown> {
	return layer_yaml.as_array(layer_yaml.as_record(job[GROUP_KEY])?.[JOBS_KEY]) ?? []
}

// The depth guard the `extends` walk gets from its `seen` set. A YAML anchor can make a `jobs`
// sequence reference itself, and js-yaml hands back the cyclic object rather than refusing it — so
// without a floor here a hand-written anchor crashes the whole command on a stack overflow, in the
// one module that is otherwise defensive about every input it is given.
const MAX_JOB_DEPTH = 10

function job_steps(
	layer: string,
	entries: ReadonlyArray<unknown>,
	depth: number = MAX_JOB_DEPTH,
): Array<LayerStep> {
	if (depth <= 0) return []

	return entries.flatMap((value, index) => {
		const job = layer_yaml.as_record(value) ?? {}
		const own = command_step(layer, job_name(job, index), job)

		return [...(own === undefined ? [] : [own]), ...job_steps(layer, nested_jobs(job), depth - 1)]
	})
}

function section_steps(layer: string, value: unknown): Array<LayerStep> {
	const section = layer_yaml.as_record(value)
	if (section === undefined) return []

	return [
		...commands_of(layer, section),
		...job_steps(layer, layer_yaml.as_array(section[JOBS_KEY]) ?? []),
		...setup_of(layer, section),
	]
}

// One lefthook document's steps, without following its `extends`.
function hook_steps_from_yaml(content: string): Array<LayerStep> {
	const document = layer_yaml.parse_document(content)
	if (document === undefined) return []

	return Object.entries(document).flatMap(([layer, value]) => section_steps(layer, value))
}

function extends_paths(content: string, from_path: string): Array<string> {
	const document = layer_yaml.parse_document(content)
	if (document === undefined) return []

	return layer_yaml
		.string_list(document[EXTENDS_KEY])
		.map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(path.dirname(from_path), entry)))
}

function read_document(from_path: string): HookDocument | undefined {
	const content = layer_yaml.read_text(from_path)
	if (content === undefined) return undefined

	return { path: from_path, content }
}

// Named rather than written inline as `!seen.has(entry)`: `Set.prototype.difference`, which the
// inline form would be rewritten to, is not in this project's TypeScript lib target.
function is_unread(entry: string, seen: ReadonlySet<string>): boolean {
	return !seen.has(entry)
}

// The entry document and everything it extends, each read at most once so a cyclic `extends` pair
// cannot loop. A path that cannot be read contributes nothing rather than stopping the walk: a
// consumer whose `extends` names a file it has not installed yet still gets a report of the rest.
function collect_documents(
	paths: ReadonlyArray<string>,
	seen: ReadonlySet<string>,
): Array<HookDocument> {
	// De-duplicated within this level as well as against `seen`: two documents extending the same
	// base, or one `extends` list naming a file twice, would otherwise be read and expanded twice
	// and put duplicate entries in every `steps` array of `--json`.
	const fresh = [...new Set(paths)].filter((entry) => is_unread(entry, seen))
	if (fresh.length === 0) return []

	const documents = fresh
		.map((entry) => read_document(entry))
		.filter((document): document is HookDocument => document !== undefined)
	const extended = documents.flatMap((document) => extends_paths(document.content, document.path))

	return [...documents, ...collect_documents(extended, new Set([...seen, ...fresh]))]
}

function read_hook_steps(root: string): Array<LayerStep> {
	const entry = path.resolve(root, LEFTHOOK_ENTRY)

	return collect_documents([entry], new Set()).flatMap((document) =>
		hook_steps_from_yaml(document.content),
	)
}

const layer_hooks = { LEFTHOOK_ENTRY, extends_paths, hook_steps_from_yaml, read_hook_steps }

export { layer_hooks }
