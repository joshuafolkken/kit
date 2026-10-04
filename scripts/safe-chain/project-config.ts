import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { file_reader } from '#scripts/lib/read-file'
import { yaml_document } from '#scripts/lib/yaml-document'
import { release_age } from '#scripts/version/release-age'
import { dump } from 'js-yaml'
import { z } from 'zod'

const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const PROJECT_CONFIG_FILE = '.aikido'
const NPMRC_FILE = '.npmrc'
const EXCLUSIONS_FIELD = 'minimumPackageAgeExclusions'
const AGE_FIELD = 'minimumPackageAgeHours'
const MINUTES_PER_HOUR = 60
const workspace_schema = z.object({ minimumReleaseAgeExclude: z.array(z.string()).optional() })

function read_mapping(value: unknown, label: string): Record<string, unknown> {
	if (value === undefined) return {}
	if (yaml_document.is_mapping_document(value)) return value
	throw new Error(`${label} must be a YAML mapping`)
}

function is_block_line(line: string): boolean {
	return line.trim() === '' || line.startsWith(' ') || line.startsWith('\t')
}

function trim_block_end(lines: ReadonlyArray<string>, start: number, end: number): number {
	let trimmed = end
	while (trimmed > start + 1 && lines[trimmed - 1]?.trim() === '') trimmed -= 1

	return trimmed
}

function find_block_end(lines: ReadonlyArray<string>, start: number): number {
	const remaining = lines.slice(start + 1)
	const relative = remaining.findIndex((line, index) => {
		if (is_block_line(line)) return false
		if (!line.startsWith('#')) return true
		const next = remaining
			.slice(index + 1)
			.find((candidate) => candidate.trim() !== '' && !candidate.startsWith('#'))

		return next === undefined || !is_block_line(next)
	})
	const end = relative === -1 ? lines.length : start + 1 + relative

	return trim_block_end(lines, start, end)
}

function append_block(existing: string, block: string): string {
	if (existing.length === 0) return block
	const prefix = existing.endsWith('\n') ? existing : `${existing}\n`

	return `${prefix}\n${block}`
}

function preserve_anchor(block: string, key_line: string): string {
	const anchor = /(?:^|\s)(&[^\s#]+)/u.exec(key_line)?.[1]
	if (!anchor) return block
	const header = 'safe-chain:'

	return `${header} ${anchor}${block.slice(header.length)}`
}

function replace_safe_chain_block(existing: string, safe_chain: Record<string, unknown>): string {
	const block = dump({ 'safe-chain': safe_chain }, { lineWidth: -1 })
	const lines = existing.split('\n')
	const start = lines.findIndex((line) =>
		/^(?:safe-chain|'safe-chain'|"safe-chain")\s*:/u.test(line),
	)
	if (start === -1) return append_block(existing, block)
	const replacement = preserve_anchor(block, lines[start] ?? '')
	const end = find_block_end(lines, start)
	const prefix = lines.slice(0, start).join('\n')
	const suffix = lines.slice(end).join('\n')

	return `${prefix}${prefix ? '\n' : ''}${replacement}${suffix}`
}

// Safe Chain enforces its own minimum package age (48 hours by default), so CI refused lockfiles pnpm
// had resolved under `.npmrc`'s shorter window (kit #2743). `.npmrc` is the source: its minutes are
// floored to whole hours so Safe Chain is never stricter than pnpm, and an undeclared window writes
// nothing; an explicit `0` opt-out is written as 0 so an earlier synchronized age cannot outlive it.
function package_age_hours(npmrc: string): number | undefined {
	const minutes = release_age.parse_declared_minimum_release_age(npmrc)
	if (minutes === undefined) return undefined

	return Math.floor(minutes / MINUTES_PER_HOUR)
}

function merge_age(safe_chain: Record<string, unknown>, npmrc: string): Record<string, unknown> {
	const hours = package_age_hours(npmrc)
	if (hours === undefined) return safe_chain

	return { ...safe_chain, [AGE_FIELD]: hours }
}

function merge_exclusions(
	safe_chain: Record<string, unknown>,
	exclusions: ReadonlyArray<string>,
): Record<string, unknown> {
	const npm = read_mapping(safe_chain['npm'], 'safe-chain.npm')

	return { ...safe_chain, npm: { ...npm, [EXCLUSIONS_FIELD]: exclusions } }
}

function has_nothing_to_write(
	existing: string,
	exclusions: ReadonlyArray<string>,
	npmrc: string,
): boolean {
	return existing.length === 0 && exclusions.length === 0 && package_age_hours(npmrc) === undefined
}

function read_exclusions(workspace: string): ReadonlyArray<string> {
	return workspace_schema.parse(yaml_document.parse_yaml(workspace)).minimumReleaseAgeExclude ?? []
}

function merge_project_config(existing: string, workspace: string, npmrc = ''): string {
	const exclusions = read_exclusions(workspace)
	const aikido = yaml_document.parse_yaml(existing)
	const safe_chain = read_mapping(aikido['safe-chain'], 'safe-chain')
	const merged = merge_age(merge_exclusions(safe_chain, exclusions), npmrc)
	if (JSON.stringify(merged) === JSON.stringify(safe_chain)) return existing
	if (has_nothing_to_write(existing, exclusions, npmrc)) return existing

	return replace_safe_chain_block(existing, merged)
}

function sync_project_config(root: string): boolean {
	const workspace_path = path.join(root, WORKSPACE_FILE)
	if (!existsSync(workspace_path)) return false
	const config_path = path.join(root, PROJECT_CONFIG_FILE)
	const existing = file_reader.read_file_or_empty(config_path)
	const workspace = readFileSync(workspace_path, 'utf8')
	const npmrc = file_reader.read_file_or_empty(path.join(root, NPMRC_FILE))
	const merged = merge_project_config(existing, workspace, npmrc)
	if (merged === existing) return false
	writeFileSync(config_path, merged)

	return true
}

const project_config = { merge_project_config, sync_project_config }

export { project_config, PROJECT_CONFIG_FILE }
