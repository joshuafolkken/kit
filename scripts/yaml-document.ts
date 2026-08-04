import { json_object_schema } from '#scripts/schemas'
import { load, loadAll, YAMLException } from 'js-yaml'

// js-yaml 5 throws "expected a document, but the input is empty" for input with no document node
// (empty / whitespace / comment-only), whereas js-yaml 4 returned undefined. Restore the v4
// semantics so reading an empty or comment-only file yields {} instead of throwing.
const EMPTY_YAML_REASON = 'expected a document, but the input is empty'

function load_yaml_or_empty(content: string): unknown {
	try {
		return load(content)
	} catch (error) {
		if (error instanceof YAMLException && error.reason === EMPTY_YAML_REASON) return {}
		throw error
	}
}

// Shared by every reader that needs a YAML file as a plain object: the config-merge list patcher
// and the overrides protection check both parse `pnpm-workspace.yaml`-shaped documents, and a
// second copy of the empty-document handling would drift the moment js-yaml changes again.
function parse_yaml(content: string): Record<string, unknown> {
	const raw = load_yaml_or_empty(content)
	if (raw === null || raw === undefined) return {}

	return json_object_schema.parse(raw)
}

function is_mapping_document(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// pnpm 11 writes pnpm-lock.yaml as a multi-document stream (the package-manager document, then the
// dependency graph), which `load` rejects outright. Non-mapping documents are dropped rather than
// rejected: a reader only ever looks up keys, and a stream that legitimately carries a scalar
// document should not make the whole file unreadable.
function parse_yaml_documents(content: string): Array<Record<string, unknown>> {
	if (content.trim().length === 0) return []

	const documents: Array<unknown> = []

	loadAll(content, (document) => {
		documents.push(document)
	})

	return documents.filter(is_mapping_document)
}

const yaml_document = { parse_yaml, parse_yaml_documents }

export { yaml_document }
