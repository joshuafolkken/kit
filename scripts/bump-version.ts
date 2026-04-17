#!/usr/bin/env tsx
/**
 * Bump package.json version without invoking npm.
 * Usage: tsx scripts/bump-version.ts [major|minor|patch]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARGV_INDEX = 2
const bump = process.argv[ARGV_INDEX] ?? 'minor'

if (!['major', 'minor', 'patch'].includes(bump)) {
	console.error(`Usage: tsx scripts/bump-version.ts [major|minor|patch]`)
	process.exit(1)
}

const package_path = path.join(process.cwd(), 'package.json')
const package_json = JSON.parse(readFileSync(package_path, 'utf8')) as { version: string }
const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(package_json.version)

if (!match) {
	console.error('Invalid or pre-release version format (not supported):', package_json.version)
	process.exit(1)
}

const MAJOR_INDEX = 1
const MINOR_INDEX = 2
const PATCH_INDEX = 3
const major = Number(match[MAJOR_INDEX])
const minor = Number(match[MINOR_INDEX])
const patch = Number(match[PATCH_INDEX])

switch (bump) {
	case 'major': {
		package_json.version = `${String(major + 1)}.0.0`

		break
	}

	case 'minor': {
		package_json.version = `${String(major)}.${String(minor + 1)}.0`

		break
	}

	case 'patch': {
		package_json.version = `${String(major)}.${String(minor)}.${String(patch + 1)}`

		break
	}

	default: {
		console.error('Invalid bump type:', bump)
		process.exit(1)
	}
}

writeFileSync(package_path, `${JSON.stringify(package_json, undefined, '\t')}\n`)
console.info(package_json.version)
