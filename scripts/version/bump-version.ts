import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { error_text } from '#scripts/lib/error-message'
import { json_object_schema, package_with_version_schema } from '#scripts/lib/schemas'
import semver from 'semver'

const VALID_BUMP_TYPES = ['major', 'minor', 'patch'] as const
type BumpType = (typeof VALID_BUMP_TYPES)[number]

const BUMP_TYPE_NAMES: ReadonlySet<string> = new Set(VALID_BUMP_TYPES)
const PACKAGE_JSON_INDENT = '\t'
const USAGE = 'Usage: josh bump [major|minor|patch]'
const FAILURE_EXIT_CODE = 1

function compute_new_version(version: string, bump_type: BumpType): string {
	const new_version = semver.inc(version, bump_type)

	if (new_version === null) throw new Error(`Invalid version format: ${version}`)

	return new_version
}

function package_json_path(): string {
	return path.join(process.cwd(), 'package.json')
}

// **Set the version to an already-decided number.** `bump_version` below is this plus the decision;
// `pnpm josh release` supplies its own, because a release raises the version by as many minors as
// main has taken merges rather than by one. Written once so the two agree
// on the file's shape and indentation.
function write_version(new_version: string): void {
	const package_path = package_json_path()
	const package_json = json_object_schema.parse(JSON.parse(readFileSync(package_path, 'utf8')))

	writeFileSync(
		package_path,
		`${JSON.stringify({ ...package_json, version: new_version }, undefined, PACKAGE_JSON_INDENT)}\n`,
	)
}

function read_current_version(): string {
	const file_content = readFileSync(package_json_path(), 'utf8')

	return package_with_version_schema.parse(JSON.parse(file_content)).version
}

function bump_version(bump_type: BumpType): void {
	const new_version = compute_new_version(read_current_version(), bump_type)

	write_version(new_version)
	console.info(new_version)
}

function is_bump_type(value: string): value is BumpType {
	return BUMP_TYPE_NAMES.has(value)
}

// `josh bump`'s body, answering its exit code to `bump-version-main.ts`.
function run_bump_version(args: ReadonlyArray<string>): number {
	const [bump_type = 'minor'] = args

	if (!is_bump_type(bump_type)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	try {
		bump_version(bump_type)
	} catch (error) {
		console.error(error_text.message_of(error))

		return FAILURE_EXIT_CODE
	}

	return 0
}

export { bump_version, compute_new_version, run_bump_version, USAGE, write_version }
