#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { json_object_schema, package_with_version_schema } from '#scripts/schemas'
import semver from 'semver'

const VALID_BUMP_TYPES = ['major', 'minor', 'patch'] as const
type BumpType = (typeof VALID_BUMP_TYPES)[number]

const PACKAGE_JSON_INDENT = '\t'

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
// main has taken merges rather than by one (joshuafolkken/kit#1169). Written once so the two agree
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

function main(): void {
	const ARGV_INDEX = 2
	const bump_type = process.argv[ARGV_INDEX] ?? 'minor'

	if (!VALID_BUMP_TYPES.includes(bump_type as BumpType)) {
		console.error(`Usage: tsx scripts/version/bump-version.ts [major|minor|patch]`)
		process.exit(1)
	}

	try {
		bump_version(bump_type as BumpType)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { bump_version, compute_new_version, write_version }
export type { BumpType }
