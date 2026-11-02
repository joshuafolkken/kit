#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { observation_depth, type DepthAnswer } from './observation-depth'

// `josh observation:depth <path>` — the depth test's depth for a subject path. Exactly one token on
// stdout (`d0`, `d1`, `d2`) — `d1` and deeper are the `<depth>` `observation:record` takes, `d0` is
// filed rather than recorded; the row it applied goes to stderr. The path is read from the caller's
// directory (`INIT_CWD`, which pnpm sets) against the repository root josh runs in.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh observation:depth <path>'

interface DepthPlaces {
	root: string
	cwd: string
}

function applied_row(subject_path: string, answer: DepthAnswer): string {
	const reason =
		answer.matched === undefined ? 'no deeper row claims it' : `under ${answer.matched}`

	return `${subject_path} → ${answer.depth}: ${answer.subject} (${reason})`
}

function refuse(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

function run(argv: ReadonlyArray<string>, places: DepthPlaces): number {
	const [typed = ''] = argv

	if (typed === '' || argv.length !== 1) return refuse(USAGE)

	const subject_path = observation_depth.repository_path(places.root, places.cwd, typed)

	if (subject_path === undefined) return refuse(`Refused: ${typed} is outside ${places.root}`)

	const answer = observation_depth.of(subject_path)

	console.error(applied_row(subject_path, answer))
	console.info(answer.depth)

	return 0
}

const observation_depth_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = process.cwd()

	process.exitCode = observation_depth_cli.run(process.argv.slice(ARGV_OFFSET), {
		root,
		cwd: process.env['INIT_CWD'] ?? root,
	})
}

export { observation_depth_cli }
