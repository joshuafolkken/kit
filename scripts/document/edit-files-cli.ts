#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { document_section } from './document-section'

// `josh edit:files <plan-path>` — apply several content-addressed edits in one call
// (joshuafolkken/kit#2366).
//
// **This is the write-side counterpart of `read:files`, and it reverses what kit#2202 rejected.**
// kit#2202 folded the pre-edit *reads* into one call and left the edits to native multiple `Edit`
// blocks, on the ground that presupposing a multi-edit tool would leave the rule unfired on a harness
// that lacks one. kit#2366 measured that bet across six lanes: 230 of 230 edit turns issued a single
// `Edit`, a per-turn density of exactly 1.000 — native multiple edits never happened. A `pnpm josh`
// command runs on every harness, so folding the edits into one is available where the native shape was
// not, and the only lever measured to move round-trip density is a composite command (kit#2165 /
// kit#2162 / kit#2202), never advice (kit#1304 / kit#1329 / kit#1337 / kit#2164 / kit#2276).
//
// **Each edit is content-addressed, so a false fold surfaces rather than corrupts.** An edit names the
// exact `old` text it was written against; a plan whose `old` matches no line, or more than one, is
// refused for that edit and reported — the same guarantee the `Edit` tool gives, and the reason the
// batching guard can hand this command out safely (`time-batch-guard.ts` → the write-side fold).
//
// **A file is written only when every one of its edits applied.** The edits of one file are applied in
// order against the running text, so a later edit sees an earlier one's result; if any of them fails to
// match, that file is left exactly as it was and its failures are named. So a partial plan never leaves
// a file half-edited.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NONE = 0
const SINGLE = 1
const USAGE = 'Usage: josh edit:files <plan-path>'

// The plan format, chosen for a model to author without escaping code into JSON: a `=====`-fenced path
// header — the same rule `read:files` prints between files — then a git-conflict-marker pair. Every
// block is one edit; several blocks may name one file. The markers are matched as whole lines, so a
// `=======` inside the edited text is only a separator when it stands alone on its own line.
const BLOCK = /===== (.+?) =====\n<<<<<<< OLD\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> NEW/gu
const PATH_GROUP = 1
const OLD_GROUP = 2
const NEW_GROUP = 3

const APPLIED = 'applied'
const NO_MATCH = 'no match'
const AMBIGUOUS = 'ambiguous'
const MISSING = 'missing'

interface EditSpec {
	path: string
	old: string
	new: string
}

interface EditResult {
	spec: EditSpec
	status: string
	count: number
}

// Every conflict block in the plan, in the order written. A group with a missing capture reads as
// empty text rather than throwing, so a malformed block fails at match time with a clear report.
function parse_plan(text: string): ReadonlyArray<EditSpec> {
	return [...text.matchAll(BLOCK)].map((match) => ({
		path: match[PATH_GROUP] ?? '',
		old: match[OLD_GROUP] ?? '',
		new: match[NEW_GROUP] ?? '',
	}))
}

// How many times the `old` text occurs, counted the way a unique-match replace needs it: zero is a
// miss, more than one is ambiguous, and only exactly one is safe to replace.
function match_count(haystack: string, needle: string): number {
	return haystack.split(needle).length - SINGLE
}

// Apply one edit to the running text, or report why it could not. The replacement is passed as a
// function so a `$` in the new text is written literally rather than read as a `String#replace` token,
// and the single-match gate above means only the intended occurrence is swapped.
function apply_one(content: string, spec: EditSpec): { text: string; result: EditResult } {
	const count = match_count(content, spec.old)
	if (count === NONE) return { text: content, result: { spec, status: NO_MATCH, count } }
	if (count > SINGLE) return { text: content, result: { spec, status: AMBIGUOUS, count } }

	const text = content.replace(spec.old, () => spec.new)

	return { text, result: { spec, status: APPLIED, count } }
}

// One file's edits folded against its text in order, each edit seeing the previous one's result.
function fold_edits(
	original: string,
	specs: ReadonlyArray<EditSpec>,
): { text: string; results: Array<EditResult> } {
	const results: Array<EditResult> = []
	let text = original

	for (const spec of specs) {
		const step = apply_one(text, spec)

		text = step.text
		results.push(step.result)
	}

	return { text, results }
}

// The edits of one file. Every edit is reported; the file is written only when all of them applied, so
// a plan that half-matches leaves the file untouched.
function apply_file(
	root: string,
	file: string,
	specs: ReadonlyArray<EditSpec>,
): ReadonlyArray<EditResult> {
	const resolved = path.resolve(root, file)
	const original = document_section.read_optional(resolved)
	if (original === undefined) return specs.map((spec) => ({ spec, status: MISSING, count: NONE }))

	const { text, results } = fold_edits(original, specs)
	if (results.every((result) => result.status === APPLIED)) writeFileSync(resolved, text)

	return results
}

// The edits grouped by their file, insertion order preserved on both the keys and each file's list, so
// the report reads in the order the plan was written.
function group_by_path(specs: ReadonlyArray<EditSpec>): Map<string, Array<EditSpec>> {
	const groups = new Map<string, Array<EditSpec>>()
	for (const spec of specs) groups.set(spec.path, [...(groups.get(spec.path) ?? []), spec])

	return groups
}

function apply_all(root: string, specs: ReadonlyArray<EditSpec>): ReadonlyArray<EditResult> {
	return [...group_by_path(specs)].flatMap(([file, file_specs]) =>
		apply_file(root, file, file_specs),
	)
}

// One line per edit: what happened and to which file, with the match count where it explains the
// failure. `applied` is the only success; every other status makes the whole call non-zero.
function describe(result: EditResult): string {
	if (result.status === APPLIED) return `${APPLIED} ${result.spec.path}`

	if (result.status === AMBIGUOUS) {
		return `${AMBIGUOUS} (${String(result.count)}) ${result.spec.path}`
	}

	if (result.status === MISSING) return `${MISSING} ${result.spec.path}`

	return `${NO_MATCH} ${result.spec.path}`
}

function report(results: ReadonlyArray<EditResult>): number {
	for (const result of results) console.info(describe(result))
	const has_failure = results.some((result) => result.status !== APPLIED)

	return has_failure ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

// Read and validate the plan, or print the reason and answer `undefined`. Kept apart from `run` so the
// entry stays under the statement limit.
function load_specs(root: string, plan_path: string): ReadonlyArray<EditSpec> | undefined {
	const plan = document_section.read_optional(path.resolve(root, plan_path))

	if (plan === undefined) {
		console.error(`Cannot read ${plan_path}`)

		return undefined
	}

	const specs = parse_plan(plan)

	if (specs.length === NONE) {
		console.error(`No edit blocks in ${plan_path}`)

		return undefined
	}

	return specs
}

function run(argv: ReadonlyArray<string>, root: string = process.cwd()): number {
	const [plan_path] = argv

	if (plan_path === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const specs = load_specs(root, plan_path)
	if (specs === undefined) return FAILURE_EXIT_CODE

	return report(apply_all(root, specs))
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const edit_files_cli = {
	USAGE,
	main,
	parse_plan,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { edit_files_cli }
