import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'
import { package_path } from './init-paths'

// A distributed workflow that calls `uses: ./.github/actions/<name>` resolves that action from the
// consumer's own checkout, so the action has to travel with it. `pr-classification.yml` was moved
// onto `.github/actions/setup-pnpm` while the action stayed kit-only, and the consumer's Release
// classification check could no longer resolve it (joshuafolkken/kit#3013).
const LOCAL_ACTION_PATTERN =
	/^\s*(?:-\s+)?uses:\s+\.\/(\.github\/actions\/[^\s#]+?)\/?\s*(?:#.*)?$/u
const ACTION_FILE_NAMES = ['action.yml', 'action.yaml']
const YAML_PATTERN = /\.ya?ml$/u
const PR_CLASSIFICATION = '.github/workflows/pr-classification.yml'
const SETUP_PNPM = '.github/actions/setup-pnpm'

interface DistributedSource {
	source: string
	destination: string
}

function distributed_yaml_sources(): Array<DistributedSource> {
	const files = init_logic.get_ai_copy_files().map((file) => ({ source: file, destination: file }))
	const mappings = init_logic
		.get_ai_copy_file_mappings()
		.map((mapping) => ({ source: mapping.src, destination: mapping.dest }))

	return [...files, ...mappings].filter((entry) => YAML_PATTERN.test(entry.destination))
}

function referenced_local_actions(source: string): Array<string> {
	return readFileSync(package_path(source), 'utf8')
		.split('\n')
		.map((line) => LOCAL_ACTION_PATTERN.exec(line)?.[1])
		.filter((directory) => directory !== undefined)
}

function is_distributed_action(directory: string): boolean {
	const destinations = new Set(distributed_yaml_sources().map((entry) => entry.destination))

	return ACTION_FILE_NAMES.some((file_name) => destinations.has(`${directory}/${file_name}`))
}

function local_action_references(): Array<[string, string]> {
	return distributed_yaml_sources().flatMap((entry) =>
		referenced_local_actions(entry.source).map((directory): [string, string] => [
			entry.destination,
			directory,
		]),
	)
}

describe('distributed local composite actions', () => {
	it('finds the setup-pnpm action pr-classification.yml calls', () => {
		expect(local_action_references()).toContainEqual([PR_CLASSIFICATION, SETUP_PNPM])
	})

	it.each(local_action_references())('%s calls %s, which is distributed too', (_, directory) => {
		expect(is_distributed_action(directory)).toBe(true)
	})

	it('answers false for an action directory nothing distributes', () => {
		expect(is_distributed_action('.github/actions/not-distributed')).toBe(false)
	})
})
