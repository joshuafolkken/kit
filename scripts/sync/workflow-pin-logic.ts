import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'

// .github/workflows is the single source of truth for action SHA pins. The
// distributed templates/workflows/* intentionally diverge in structure (steps,
// commands, comment language), so only the `uses:` pins are propagated.
const RUNTIME_WORKFLOWS_DIR = '.github/workflows'
const TEMPLATE_WORKFLOWS_DIR = 'templates/workflows'
const USES_KEY = 'uses:'
const YAML_PATTERN = /\.ya?ml$/u
const SYNC_HINT = '  Run `pnpm josh sync-workflow-pins` to sync template workflow pins.'

interface ActionPin {
	name: string
	ref: string
}

interface PinDrift {
	template: string
	line: number
	action: string
	from: string
	to: string
}

interface WorkflowSource {
	file: string
	text: string
}

function parse_uses_line(line: string): ActionPin | undefined {
	const key_index = line.indexOf(USES_KEY)
	if (key_index === -1 || line.slice(0, key_index).trim() !== '') return undefined

	const value = line.slice(key_index + USES_KEY.length).trim()
	const at_index = value.indexOf('@')
	if (at_index === -1) return undefined

	return { name: value.slice(0, at_index), ref: value.slice(at_index + 1) }
}

function conflict_message(name: string, existing: string, found: string, file: string): string {
	return `Action ${name} pinned to conflicting refs in .github/workflows: "${existing}" vs "${found}" (${file})`
}

function add_pin(pins: Map<string, string>, pin: ActionPin, file: string): void {
	const existing = pins.get(pin.name)

	if (existing !== undefined && existing !== pin.ref) {
		throw new Error(conflict_message(pin.name, existing, pin.ref, file))
	}

	pins.set(pin.name, pin.ref)
}

function collect_into(pins: Map<string, string>, source: WorkflowSource): void {
	for (const line of source.text.split('\n')) {
		const pin = parse_uses_line(line)
		if (pin) add_pin(pins, pin, source.file)
	}
}

function collect_canonical(sources: ReadonlyArray<WorkflowSource>): Map<string, string> {
	const pins = new Map<string, string>()
	for (const source of sources) collect_into(pins, source)

	return pins
}

function drift_for_line(
	template: string,
	line: string,
	index: number,
	canonical: ReadonlyMap<string, string>,
): PinDrift | undefined {
	const pin = parse_uses_line(line)
	if (!pin) return undefined

	const want = canonical.get(pin.name)
	if (want === undefined || want === pin.ref) return undefined

	return { template, line: index + 1, action: pin.name, from: pin.ref, to: want }
}

function find_drift_in_text(
	template: string,
	text: string,
	canonical: ReadonlyMap<string, string>,
): Array<PinDrift> {
	const drifts: Array<PinDrift> = []

	for (const [index, line] of text.split('\n').entries()) {
		const drift = drift_for_line(template, line, index, canonical)
		if (drift) drifts.push(drift)
	}

	return drifts
}

function rewrite_line(line: string, canonical: ReadonlyMap<string, string>): string {
	const pin = parse_uses_line(line)
	if (!pin) return line

	const want = canonical.get(pin.name)
	if (want === undefined || want === pin.ref) return line

	const key_index = line.indexOf(USES_KEY)

	return `${line.slice(0, key_index)}${USES_KEY} ${pin.name}@${want}`
}

function apply_to_text(text: string, canonical: ReadonlyMap<string, string>): string {
	return text
		.split('\n')
		.map((line) => rewrite_line(line, canonical))
		.join('\n')
}

function read_source(relative_directory: string, name: string): WorkflowSource {
	const file = path.join(relative_directory, name)

	return { file, text: readFileSync(package_path(file), 'utf8') }
}

function list_workflow_sources(relative_directory: string): Array<WorkflowSource> {
	return readdirSync(package_path(relative_directory))
		.filter((name) => YAML_PATTERN.test(name))
		.toSorted((left, right) => left.localeCompare(right))
		.map((name) => read_source(relative_directory, name))
}

function build_canonical_pins(): Map<string, string> {
	return collect_canonical(list_workflow_sources(RUNTIME_WORKFLOWS_DIR))
}

function find_pin_drift(): Array<PinDrift> {
	const canonical = build_canonical_pins()

	return list_workflow_sources(TEMPLATE_WORKFLOWS_DIR).flatMap((source) =>
		find_drift_in_text(source.file, source.text, canonical),
	)
}

function write_synced(source: WorkflowSource, canonical: ReadonlyMap<string, string>): void {
	const synced = apply_to_text(source.text, canonical)
	if (synced !== source.text) writeFileSync(package_path(source.file), synced)
}

function sync_pins(): Array<PinDrift> {
	const canonical = build_canonical_pins()
	const drifts = find_pin_drift()

	for (const source of list_workflow_sources(TEMPLATE_WORKFLOWS_DIR)) {
		write_synced(source, canonical)
	}

	return drifts
}

function format_drift_message(drifts: ReadonlyArray<PinDrift>): string {
	const lines = drifts.map(
		(drift) =>
			`  - ${drift.template}:${String(drift.line)} ${drift.action}: ${drift.from} → ${drift.to}`,
	)

	return [
		'✖ Template workflow action pins drifted from .github/workflows:',
		...lines,
		SYNC_HINT,
	].join('\n')
}

const workflow_pin_logic = {
	RUNTIME_WORKFLOWS_DIR,
	TEMPLATE_WORKFLOWS_DIR,
	parse_uses_line,
	collect_canonical,
	find_drift_in_text,
	apply_to_text,
	build_canonical_pins,
	find_pin_drift,
	sync_pins,
	format_drift_message,
}

export { workflow_pin_logic }
export type { ActionPin, PinDrift, WorkflowSource }
