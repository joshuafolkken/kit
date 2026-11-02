#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { observation_depth, type DepthAnswer } from './observation-depth'

// `josh observation:depth <path>` — the depth test's depth for a subject path. Exactly one token on
// stdout (`d0`, `d1`, `d2`), the `<depth>` `observation:record` takes; the row it applied goes to stderr.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh observation:depth <path>'

function applied_row(subject_path: string, answer: DepthAnswer): string {
	const reason =
		answer.matched === undefined ? 'no deeper row claims it' : `under ${answer.matched}`

	return `${subject_path} → ${answer.depth}: ${answer.subject} (${reason})`
}

function run(argv: ReadonlyArray<string>): number {
	const [subject_path = ''] = argv

	if (subject_path === '' || argv.length !== 1) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const answer = observation_depth.of(subject_path)

	console.error(applied_row(subject_path, answer))
	console.info(answer.depth)

	return 0
}

const observation_depth_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = observation_depth_cli.run(process.argv.slice(ARGV_OFFSET))
}

export { observation_depth_cli }
