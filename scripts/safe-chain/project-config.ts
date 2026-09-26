import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { yaml_document } from '#scripts/yaml/yaml-document'
import { dump } from 'js-yaml'
import { z } from 'zod'

const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const PROJECT_CONFIG_FILE = '.aikido'
const EXCLUSIONS_FIELD = 'minimumPackageAgeExclusions'
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
	const relative = lines.slice(start + 1).findIndex((line) => !is_block_line(line))
	const end = relative === -1 ? lines.length : start + 1 + relative

	return trim_block_end(lines, start, end)
}

function append_block(existing: string, block: string): string {
	if (existing.length === 0) return block
	const prefix = existing.endsWith('\n') ? existing : `${existing}\n`

	return `${prefix}\n${block}`
}

function replace_safe_chain_block(existing: string, safe_chain: Record<string, unknown>): string {
	const block = dump({ 'safe-chain': safe_chain }, { lineWidth: -1 })
	const lines = existing.split('\n')
	const start = lines.findIndex((line) =>
		/^(?:safe-chain|'safe-chain'|"safe-chain")\s*:/u.test(line),
	)
	if (start === -1) return append_block(existing, block)
	const end = find_block_end(lines, start)
	const prefix = lines.slice(0, start).join('\n')
	const suffix = lines.slice(end).join('\n')

	return `${prefix}${prefix ? '\n' : ''}${block}${suffix}`
}

function merge_project_config(existing: string, workspace: string): string {
	const source = workspace_schema.parse(yaml_document.parse_yaml(workspace))
	const exclusions = source.minimumReleaseAgeExclude ?? []
	const aikido = yaml_document.parse_yaml(existing)
	const safe_chain = read_mapping(aikido['safe-chain'], 'safe-chain')
	const npm = read_mapping(safe_chain['npm'], 'safe-chain.npm')
	if (JSON.stringify(npm[EXCLUSIONS_FIELD]) === JSON.stringify(exclusions)) return existing
	if (exclusions.length === 0 && existing.length === 0) return existing

	const merged = { ...safe_chain, npm: { ...npm, [EXCLUSIONS_FIELD]: exclusions } }

	return replace_safe_chain_block(existing, merged)
}

function sync_project_config(root: string): boolean {
	const workspace_path = path.join(root, WORKSPACE_FILE)
	if (!existsSync(workspace_path)) return false
	const config_path = path.join(root, PROJECT_CONFIG_FILE)
	const existing = existsSync(config_path) ? readFileSync(config_path, 'utf8') : ''
	const workspace = readFileSync(workspace_path, 'utf8')
	const merged = merge_project_config(existing, workspace)
	if (merged === existing) return false
	writeFileSync(config_path, merged)

	return true
}

const project_config = { merge_project_config, sync_project_config }

export { project_config }
