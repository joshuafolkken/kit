import { yaml_document } from '#scripts/yaml-document'
import { overrides_check } from './overrides-logic'
import { lockfile_importers_schema, type LockfileImporter } from './schemas'

// The importer sections whose entries pnpm rewrites through `overrides` before resolving.
const DEPENDENCY_GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

// Specifier protocols that name a source rather than a registry range. An override cannot rewrite
// one into a comparable range, so comparing it against an override value could only ever produce a
// false mismatch.
const NON_REGISTRY_PREFIXES = ['link:', 'file:', 'workspace:', 'catalog:', 'npm:', '$']

interface SpecifierMismatch {
	importer: string
	name: string
	lockfile_specifier: string
	override: string
}

function is_non_registry(value: string): boolean {
	return NON_REGISTRY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

// A key carrying a version selector (`pkg@>=5`) applies only to the dependents whose declared range
// matches the selector, which cannot be decided from the lockfile alone. Only a bare key rewrites
// every occurrence of the package, so only a bare key yields a specifier the importer must equal.
function is_comparable_entry(key: string, value: string): boolean {
	return overrides_check.extract_package_name(key) === key && !is_non_registry(value)
}

function read_unconditional_overrides(overrides: Record<string, string>): Map<string, string> {
	const comparable = Object.entries(overrides).filter(([key, value]) =>
		is_comparable_entry(key, value),
	)

	return new Map(comparable)
}

function find_entry_mismatch(
	importer: string,
	name: string,
	specifier: string,
	override: string | undefined,
): Array<SpecifierMismatch> {
	if (override === undefined) return []
	if (is_non_registry(specifier)) return []
	if (specifier === override) return []

	return [{ importer, name, lockfile_specifier: specifier, override }]
}

function find_importer_mismatches(
	importer: string,
	sections: LockfileImporter,
	overrides: Map<string, string>,
): Array<SpecifierMismatch> {
	return DEPENDENCY_GROUPS.flatMap((group) =>
		Object.entries(sections[group] ?? {}).flatMap(([name, entry]) =>
			find_entry_mismatch(importer, name, entry.specifier, overrides.get(name)),
		),
	)
}

function read_document_importers(
	document: Record<string, unknown>,
): Array<[string, LockfileImporter]> {
	return Object.entries(lockfile_importers_schema.parse(document).importers ?? {})
}

function read_importers(lockfile_content: string): Array<[string, LockfileImporter]> {
	return yaml_document
		.parse_yaml_documents(lockfile_content)
		.flatMap((document) => read_document_importers(document))
}

// Compares what the lockfile records against what the overrides declare. pnpm writes the
// override-applied specifier into each importer entry, so a difference means the lockfile no longer
// matches the manifest pnpm derives — the state that fails `pnpm install --frozen-lockfile` in CI
// while `trustLockfile: true` keeps the same command quiet locally (kit #744).
function find_specifier_mismatches(
	lockfile_content: string,
	overrides: Record<string, string>,
): Array<SpecifierMismatch> {
	const unconditional = read_unconditional_overrides(overrides)
	if (unconditional.size === 0) return []

	return read_importers(lockfile_content).flatMap(([importer, sections]) =>
		find_importer_mismatches(importer, sections, unconditional),
	)
}

function format_mismatch_line(mismatch: SpecifierMismatch): string {
	const recorded = `lockfile ${mismatch.lockfile_specifier}, override ${mismatch.override}`

	return `  ${mismatch.name} (importer ${mismatch.importer}): ${recorded}`
}

function format_mismatch_lines(mismatches: ReadonlyArray<SpecifierMismatch>): Array<string> {
	return mismatches.map((mismatch) => format_mismatch_line(mismatch))
}

const lockfile_overrides = { find_specifier_mismatches, format_mismatch_lines }

export type { SpecifierMismatch }
export { lockfile_overrides }
