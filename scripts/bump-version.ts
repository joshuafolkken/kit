#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { json_object_schema, package_with_version_schema } from './schemas'

const ARGV_INDEX = 2
const bump = process.argv[ARGV_INDEX] ?? 'minor'

if (!['major', 'minor', 'patch'].includes(bump)) {
	console.error(`Usage: tsx scripts/bump-version.ts [major|minor|patch]`)
	process.exit(1)
}

const MAJOR_INDEX = 1
const MINOR_INDEX = 2
const PATCH_INDEX = 3

const package_path = path.join(process.cwd(), 'package.json')
const file_content = readFileSync(package_path, 'utf8')
const { version } = package_with_version_schema.parse(JSON.parse(file_content))
const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version)

if (!match) {
	console.error('Invalid or pre-release version format (not supported):', version)
	process.exit(1)
}

const major = Number(match[MAJOR_INDEX])
const minor = Number(match[MINOR_INDEX])
const patch = Number(match[PATCH_INDEX])
let new_version = version

switch (bump) {
	case 'major': {
		new_version = `${String(major + 1)}.0.0`

		break
	}

	case 'minor': {
		new_version = `${String(major)}.${String(minor + 1)}.0`

		break
	}

	case 'patch': {
		new_version = `${String(major)}.${String(minor)}.${String(patch + 1)}`

		break
	}

	default: {
		console.error('Invalid bump type:', bump)
		process.exit(1)
	}
}

const PACKAGE_JSON_INDENT = '\t'
const package_json = json_object_schema.parse(JSON.parse(file_content))

writeFileSync(
	package_path,
	`${JSON.stringify({ ...package_json, version: new_version }, undefined, PACKAGE_JSON_INDENT)}\n`,
)
console.info(new_version)
