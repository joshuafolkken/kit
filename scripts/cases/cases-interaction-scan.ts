import path from 'node:path'
import { git_grep_hits, type GrepResult } from '#scripts/git/git-grep-hits'
import { file_reader } from '#scripts/lib/read-file'
import {
	cases_interaction,
	type Interaction,
	type StatePath,
	type Wording,
} from './cases-interaction'

// The I/O half of `josh cases`' interaction boundaries (joshuafolkken/kit#4491): read the changed
// sources, then search the rest of the repository for each state path they name — by its literal and
// by every constant this source binds it to — so the summary lists the other readers and writers as
// `file:line`. Tests are left out of the search: a fixture path is not a second writer at run time.

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.js', '.mjs', '.cjs', '.svelte'])
const SOURCE_PATHSPECS: ReadonlyArray<string> = [
	'*.ts',
	'*.js',
	'*.mjs',
	'*.cjs',
	'*.svelte',
	':(exclude)*.test.ts',
]
const WHOLE_WORD = ['-w']
const MAX_OTHERS = 10

interface SharedState {
	path: string
	others: ReadonlyArray<string>
	has_failed: boolean
}

interface Findings {
	states: ReadonlyArray<SharedState>
	variables: ReadonlyArray<string>
	residents: ReadonlyArray<string>
}

function is_source(file: string): boolean {
	return SOURCE_EXTENSIONS.has(path.extname(file))
}

function repo_relative(file: string): string {
	return path.relative(process.cwd(), path.resolve(file))
}

// A module that declares its own constant of the same name holds its own state, not this one.
async function constant_hits(name: string): Promise<GrepResult> {
	const result = await git_grep_hits.search(name, WHOLE_WORD, SOURCE_PATHSPECS)
	const declaration = new RegExp(String.raw`\b(?:const|let|var)\s+${name}\b`, 'u')
	const declaring = new Set(
		result.hits.filter((hit) => declaration.test(hit.excerpt)).map((hit) => hit.path),
	)

	return { ...result, hits: result.hits.filter((hit) => !declaring.has(hit.path)) }
}

async function shared_state(state: StatePath, own: ReadonlySet<string>): Promise<SharedState> {
	const results = await Promise.all([
		git_grep_hits.search(state.path, [], SOURCE_PATHSPECS),
		...state.constants.map(async (name) => await constant_hits(name)),
	])
	const sites = results
		.flatMap((result) => result.hits)
		.filter((hit) => !own.has(hit.path))
		.map((hit) => `${hit.path}:${hit.line}`)

	return {
		path: state.path,
		others: [...new Set(sites)],
		has_failed: results.some((result) => result.has_failed),
	}
}

async function scan(paths: ReadonlyArray<string>): Promise<Findings> {
	const content = paths
		.filter((file) => is_source(file))
		.map((file) => file_reader.read_if_readable(file) ?? '')
		.join('\n')
	const own = new Set(paths.map((file) => repo_relative(file)))
	const states = await Promise.all(
		cases_interaction.state_paths_in(content).map(async (state) => await shared_state(state, own)),
	)

	return { states, ...cases_interaction.environment_in(content) }
}

function interactions_of(findings: Findings): ReadonlyArray<Interaction> {
	const has_environment = findings.variables.length + findings.residents.length > 0
	const crossed = { state: findings.states.length > 0, env: has_environment }

	return cases_interaction.INTERACTIONS.filter((interaction) => crossed[interaction])
}

function others_text(state: SharedState, words: Wording): string {
	if (state.has_failed) return words.search_failed
	if (state.others.length === 0) return words.no_others

	const shown = state.others.slice(0, MAX_OTHERS)
	const rest = state.others.length - shown.length

	return rest > 0 ? `${shown.join(', ')}, +${String(rest)}` : shown.join(', ')
}

function line(label: string, subject: string, owed: ReadonlyArray<string>): string {
	return `${label} ${subject}: ${owed.join(' / ')}`
}

// One line per state, variable and resident process, in that order — each carries its own subject,
// so the reader sees whose cases they are without a second table.
function lines_for(findings: Findings, lang?: string): ReadonlyArray<string> {
	const words = cases_interaction.wording(lang)
	const state_lines = findings.states.map((state) =>
		line(
			words.state,
			`\`${state.path}\` (${words.others}: ${others_text(state, words)})`,
			words.state_cases,
		),
	)
	const variable_lines = findings.variables.map((name) =>
		line(words.variable, `\`${name}\``, words.variable_cases),
	)
	const resident_lines = findings.residents.map((name) =>
		line(words.resident, `\`${name}\``, words.resident_cases),
	)

	return [...state_lines, ...variable_lines, ...resident_lines]
}

const cases_interaction_scan = { scan, interactions_of, lines_for }

export type { Findings, SharedState }
export { cases_interaction_scan }
