// Sample paths for the managed config-file gate (joshuafolkken/kit#1578). Three suites ask the same
// two questions of the **real** distribution lists — a file they hold outright, and a file they hold
// only through the directory it sits in — and a copy of the pair per suite is three places to correct
// when a list changes.
//
// They are deliberately not stubs. The defect this gate exists for was a real path failing to be
// matched, so a suite that only ever saw synthetic entries would have passed throughout.

// On `AI_COPY_FILES`: matched by equality, and the one a reader would find by eye.
const DISTRIBUTED_ROOT_FILE = 'CLAUDE.md'

// On `AI_COPY_DIRECTORIES` only — it equals no list entry, so it is matched through the directory it
// sits under. This is the path the run that skipped the gate had changed.
const DISTRIBUTED_SKILL_FILE = '.claude/skills/workflow-commands/epicrun.md'

// A sibling of the distributed directory whose name merely begins with it: the case that separates a
// containment test from a prefix test.
const SIBLING_DIRECTORY_FILE = '.claude/skills/workflow-commands-extra/notes.md'

// On no `AI_COPY_*` list at all — `sync.ts` writes it directly. It is the file the prose this gate
// replaced used as its own worked example, so a matcher reading only those three lists answered
// "not distributed" for the very file the rule was written about.
const DISTRIBUTED_SYNC_ARTIFACT = 'playwright.config.ts'

export {
	DISTRIBUTED_ROOT_FILE,
	DISTRIBUTED_SKILL_FILE,
	SIBLING_DIRECTORY_FILE,
	DISTRIBUTED_SYNC_ARTIFACT,
}
