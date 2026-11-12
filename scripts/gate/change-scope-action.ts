import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// Native Node resolves the distributed source directly, without TypeScript's extension rewriting.
// eslint-disable-next-line import/extensions
import { path_glob } from './path-glob.ts'
// eslint-disable-next-line import/extensions
import { toolchain_inputs } from './toolchain-inputs.ts'

interface Manifest {
	version?: string
	files?: Array<string>
	[key: string]: unknown
}

interface ChangeScope {
	runtime: boolean
	publish: boolean
}

// Only these paths prove that executable checks can be omitted. Unknown paths run all checks.
const DOCUMENTATION = ['docs/**', 'prompts/**', '*.md']
const PACKAGE_JSON = 'package.json'
const PACKAGE_INPUTS = ['README*', 'LICENSE*']

function git(args: Array<string>): string {
	return execFileSync('/usr/bin/git', args, { encoding: 'utf8' })
}

function manifest_at(reference: string): Manifest {
	return JSON.parse(git(['show', `${reference}:${PACKAGE_JSON}`])) as Manifest
}

function metadata(manifest: Manifest): string {
	const rest = { ...manifest }

	delete rest.version

	return JSON.stringify(rest)
}

const { matches } = path_glob

function published(file: string, entries: Array<string> = []): boolean {
	const included = entries.filter((entry) => !entry.startsWith('!'))
	const excluded = entries.filter((entry) => entry.startsWith('!'))

	return (
		included.some((entry) => matches(file, entry)) &&
		excluded.every((entry) => !matches(file, entry.slice(1)))
	)
}

function consumer_input(file: string, before: Manifest, after: Manifest): boolean {
	return (
		published(file, before.files) ||
		published(file, after.files) ||
		toolchain_inputs.is_input(file) ||
		PACKAGE_INPUTS.some((pattern) => path.matchesGlob(file, pattern))
	)
}

// The version bump is the release itself, so it publishes even though it runs no checks.
function version_changed(before: Manifest, after: Manifest): boolean {
	return before.version !== after.version
}

function classify(paths: Array<string>, before: Manifest, after: Manifest): ChangeScope {
	const changed = paths.filter(
		(file) => file !== PACKAGE_JSON || metadata(before) !== metadata(after),
	)

	return {
		runtime: changed.some((file) =>
			DOCUMENTATION.every((pattern) => !path.matchesGlob(file, pattern)),
		),
		publish:
			version_changed(before, after) || changed.some((file) => consumer_input(file, before, after)),
	}
}

function main(): void {
	const base = process.env['CHANGE_BASE'] ?? ''
	const head = process.env['CHANGE_HEAD'] ?? ''
	const paths = git(['diff', '--no-renames', '--name-only', '-z', base, head, '--'])
		.split('\0')
		.filter(Boolean)
	const result = classify(paths, manifest_at(base), manifest_at(head))

	const output = Object.entries(result)
		.map(([key, value]) => `${key}=${String(value)}\n`)
		.join('')

	appendFileSync(process.env['GITHUB_OUTPUT'] ?? '', output)
	process.stdout.write(output)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

export { classify }
