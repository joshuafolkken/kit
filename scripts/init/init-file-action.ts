import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FileAction } from './init-actions'

const SAMPLE_INDENT_WIDTH = 4
const SAMPLE_INDENT = ' '.repeat(SAMPLE_INDENT_WIDTH)

function write_new_file(action: FileAction, destination_path: string): void {
	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, action.create())
	console.info(`  ✔ created   ${action.dest}`)
}

function show_sample(action: FileAction): void {
	console.info(`  ⚠ exists    ${action.dest} — add manually:`)
	console.info('')
	console.info(action.create().replaceAll(/^/gmu, () => SAMPLE_INDENT))
}

// A file that already holds the sample needs nothing added, so only one that differs gets it shown —
// for a create-only file (no merge) as for a merge that only migrates a kit-written line (#3069).
function report_unchanged(action: FileAction, existing: string): void {
	const is_sample_missing = existing !== action.create()
	const should_show_sample =
		action.merge === undefined || action.should_show_sample_when_unchanged === true

	if (is_sample_missing && should_show_sample) show_sample(action)
	else console.info(`  ✔ unchanged ${action.dest}`)
}

function merge_existing_file(action: FileAction, destination_path: string): void {
	const existing = readFileSync(destination_path, 'utf8')
	const merged = action.merge === undefined ? existing : action.merge(existing)

	if (merged === existing) {
		report_unchanged(action, existing)

		return
	}

	writeFileSync(destination_path, merged)
	console.info(`  ✔ updated   ${action.dest}`)
}

function execute_file_action(action: FileAction, project_root: string): void {
	const destination_path = path.join(project_root, action.dest)

	if (existsSync(destination_path)) merge_existing_file(action, destination_path)
	else write_new_file(action, destination_path)
}

const init_file_action = { execute_file_action }

export { init_file_action }
