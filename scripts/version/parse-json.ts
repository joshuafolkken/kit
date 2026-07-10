// Parse JSON without throwing: returns the parsed value, or undefined when the input is not valid
// JSON. Single source for the version commands that read package.json / CLI output and hand the
// result to a schema's `safeParse` (running-binary, version-targets, effective-upstream), so the
// permissive-parse behavior is defined once rather than re-cloned per reader.
function safe_json_parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}

export { safe_json_parse }
