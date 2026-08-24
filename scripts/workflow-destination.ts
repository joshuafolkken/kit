// Whether a path names a workflow file kit writes into a consumer. A leaf module on purpose: both
// the pin injection and the managed-marker library need this predicate, and the marker library is
// published (`@joshuafolkken/kit/managed-marker`), so reaching it through the pin logic would inline
// sync's whole `readdirSync`/`writeFileSync` graph into a bundle that only needs a regex.
//
// Matches a consumer workflow destination, absolute or repo-relative, on either separator.
const WORKFLOW_DESTINATION_PATTERN = /(?:^|[/\\])\.github[/\\]workflows[/\\][^/\\]+\.ya?ml$/u

function is_workflow_destination(destination: string): boolean {
	return WORKFLOW_DESTINATION_PATTERN.test(destination)
}

export { is_workflow_destination }
