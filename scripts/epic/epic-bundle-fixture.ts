// A body whose references count as a bundle signal.
//
// `epic:bundle` reads a relation only from a body's acceptance criteria and its `parent: #N` line, so a
// test that means "this issue names that one" has to write the reference there. Shared rather than
// spelled out per suite, so every bundle test states the relation the same way.
function in_acceptance(text: string): string {
	return `## Acceptance criteria\n\n- ${text}`
}

const epic_bundle_fixture = { in_acceptance }

export { epic_bundle_fixture }
