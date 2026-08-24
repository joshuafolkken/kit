import { is_workflow_destination } from '#scripts/workflow-destination'

// Which package overwrites a given workflow is a question only that package can answer, and the
// answer has to survive being copied on: a consumer of a consumer receives `ci.yml` from kit and
// `dast.yml` from app-kit, and neither distributor knows what the other manages. So the answer is
// written into the artifact rather than kept in a list beside it — every distributor stamps its own
// output, and the auto-merge workflow reads the stamp off the very file it is asking about
// (joshuafolkken/kit#844).
//
// A list cannot reach that far. kit's write time is the only moment kit controls, and at that moment
// it knows nothing of what app-kit distributes; whichever sync ran last would decide the list, and
// the list would drift from the files it claims to describe — which is exactly the defect #844
// reports, one distribution tier below the loop #836 closed.
//
// The stamp also draws the line the old list could only describe in prose. `deploy-vps.yml` is
// patched by sync but written directly rather than through this transform, so it is never stamped
// and a bump to its own pins still merges — a property of how the file is written, not of anyone
// remembering to leave it out of a list.
// The note names no command, because the package on the line above is not always this one: a
// package built on kit distributes its own workflows through its own `sync`, and stamps them with
// its own name through this same function.
const MARKER_TOKEN = 'josh-managed-workflow:'
const MARKER_PREFIX = `# ${MARKER_TOKEN}`
const MARKER_NOTE = 'Overwritten on every sync of that package. Edit it there, not here.'

function marker_block(package_name: string): string {
	return `${MARKER_PREFIX} ${package_name}\n# ${MARKER_NOTE}\n`
}

// Recognized by the first line rather than by the token appearing anywhere, because the auto-merge
// workflow declares the token in its own `env` to match on — a substring test would read that
// template as already stamped and skip it, leaving the one file that performs the check unmarked.
function is_marked(text: string): boolean {
	return text.startsWith(MARKER_PREFIX)
}

// `package_name` is the distributor's own name, so a package built on kit stamps its files as its
// own rather than mis-attributing them to kit. The auto-merge workflow matches the token, not any
// particular name, so every tier's stamp is recognized by the same check.
//
// An already-stamped file is left alone whoever stamped it, because the name is for the human who
// opens the file and the check does not read it. Re-attributing a file one distributor stamped and
// another later overwrote is a real question, but not one with a consumer yet — it belongs with the
// package that first does it, not with a guess made here.
function apply_marker_for_destination(
	destination: string,
	text: string,
	package_name: string,
): string {
	if (!is_workflow_destination(destination)) return text
	if (is_marked(text)) return text

	return `${marker_block(package_name)}${text}`
}

// `marker_block` stays out of the published surface: it composes a header unconditionally, so a
// distributor reaching for it instead of `apply_marker_for_destination` would stack a second one on
// every sync. The token and prefix are published because a consumer may want to match on them, and
// `is_marked` because that is the matching rule itself.
const managed_marker_logic = {
	MARKER_TOKEN,
	MARKER_PREFIX,
	is_marked,
	apply_marker_for_destination,
}

export { managed_marker_logic }
