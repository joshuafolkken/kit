#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { json_object_schema, package_with_version_schema } from './schemas'

const VALID_BUMP_TYPES = ['major', 'minor', 'patch'] as const
type BumpType = (typeof VALID_BUMP_TYPES)[number]

const MAJOR_INDEX = 1
const MINOR_INDEX = 2
const PATCH_INDEX = 3
const PACKAGE_JSON_INDENT = '\t'

function compute_new_version(version: string, bump_type: BumpType): string {
	const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version)

	if (!match) {
		throw new Error(`Invalid or pre-release version format (not supported): ${version}`)
	}

	const major = Number(match[MAJOR_INDEX])
	const minor = Number(match[MINOR_INDEX])
	const patch = Number(match[PATCH_INDEX])

	if (bump_type === 'major') return `${String(major + 1)}.0.0`
	if (bump_type === 'minor') return `${String(major)}.${String(minor + 1)}.0`

	return `${String(major)}.${String(minor)}.${String(patch + 1)}`
}

function bump_version(bump_type: BumpType): void {
	const package_path = path.join(process.cwd(), 'package.json')
	const file_content = readFileSync(package_path, 'utf8')
	const { version } = package_with_version_schema.parse(JSON.parse(file_content))
	const new_version = compute_new_version(version, bump_type)
	const package_json = json_object_schema.parse(JSON.parse(file_content))

	writeFileSync(
		package_path,
		`${JSON.stringify({ ...package_json, version: new_version }, undefined, PACKAGE_JSON_INDENT)}\n`,
	)
	console.info(new_version)
}

function main(): void {
	const ARGV_INDEX = 2
	const bump_type = process.argv[ARGV_INDEX] ?? 'minor'

	if (!VALID_BUMP_TYPES.includes(bump_type as BumpType)) {
		console.error(`Usage: tsx scripts/bump-version.ts [major|minor|patch]`)
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

export { bump_version, compute_new_version }
export type { BumpType }
