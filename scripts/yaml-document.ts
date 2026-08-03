import { json_object_schema } from '#scripts/schemas'
import { load, YAMLException } from 'js-yaml'

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

const yaml_document = { parse_yaml }

export { yaml_document }
