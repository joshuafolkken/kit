import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import { bash_triggers } from './bash-triggers'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// A dispatched lane child is stopped from running `git switch main` — the fifth of the "always fails or
// answers nothing" misfires joshuafolkken/kit#2297 catalogued (joshuafolkken/kit#2313). A lane is a
// linked work tree, `main` is checked out by the primary work tree, and git allows one branch in one
// work tree at a time — so the call is **structurally guaranteed to fail** with `fatal: 'main' is
// already used by worktree at '<the primary checkout>'`. It was measured 11 times in the 2026-09-21
// backlogrun, always in a lane child.
//
// **The source is the parent's step, not the child's.** The distributed procedures write
// `git switch main && git pull` as the step before reading the dependency scope, and that is *correct in
// the primary checkout* (`backlogrun-lanes.md` → "Once per repository, before the first lane opens"). A
// child that runs the same line verbatim fails every time, and the failure is not free: a refused call
// drops the independent calls batched beside it (joshuafolkken/kit#2177), so a batching child loses the
// most. `josh main:sync` (`main-sync.ts`) already refuses inside a linked work tree for the same reason;
// this is the *raw* form of the same call, refused before it fails rather than after.
//
// **It refuses rather than rewrites, because a `PreToolUse` guard can only `allow` / `deny` a command,
// never substitute a different one** (joshuafolkken/kit#2313 decision comment). So the refusal hands back
// the next command, exactly as #2297 required of `test:declared`: the lane is already on its own issue
// branch, branched from a fresh default before it opened, and the latest default is brought in during the
// gate by `pnpm josh main:merge` — so skip the step and keep implementing on the current branch.
//
// **The branch is judged against the lane's own, not the name `main`.** `already used by worktree` is a
// property of any branch the primary work tree holds, not of the literal `main`, and the default branch
// differs per repository — so hardcoding `main` would both miss a renamed default and need an async
// `get_default_branch`. A lane child belongs on its own `<issue>-lane` branch; a `git switch` to anything
// else is the misfire. Its own branch is read synchronously from the checkout path
// (`lane_paths.lane_issue_of`), the weaker-but-synchronous lane test a guard is bound to
// (joshuafolkken/kit#1864). `git switch` alone is covered — it never means a pathspec, so there is no
// ambiguity — and `git checkout -- <path>` stays `worktree-guard.ts`'s.
//
// **The command test comes first and the world is consulted second**, so the lane read runs only on the
// handful of calls that are a plain branch switch, not on every `Bash` call — the ordering
// `lane-carry-conflict.ts` and `worktree-guard.ts` share. A person working in a lane carries no dispatch
// mark and sees no refusal. It fires on every occurrence, not once per run: a child must never run this,
// so the route is always "continue implementing", never a reissue (`git-force.ts`).

const SWITCH_SUBCOMMAND = 'switch'

// The flags under which a `git switch` does not collide with a branch the primary work tree holds: a
// create (`-c` / `-C` / `--create` / `--force-create`) moves to a branch nothing else can hold, and a
// detach (`-d` / `--detach`) checks out a commit with no branch at all. A segment carrying any of them is
// not the misfire this rule refuses.
const NON_COLLIDING_FLAGS: ReadonlySet<string> = new Set([
	'-c',
	'-C',
	'--create',
	'--force-create',
	'-d',
	'--detach',
])

const FLAG_PREFIX = '-'

// The branch a `git switch <branch>` selects, or `undefined` when the segment is not a plain branch
// switch: not a `switch` at all, a create/detach, or with no positional target (a bare `git switch`, or
// `git switch -` for the previous branch — `-` starts with the flag prefix, so it is never read as a
// target).
function switch_target(segment: string): string | undefined {
	const call = git_argv.parse(segment)

	if (call?.subcommand !== SWITCH_SUBCOMMAND) return undefined
	if (call.args.some((argument) => NON_COLLIDING_FLAGS.has(argument))) return undefined

	return call.args.find((argument) => !argument.startsWith(FLAG_PREFIX))
}

// Every branch a shell line's `git switch` segments select. A line carries several commands, so each
// segment is judged on its own — a `git switch main && git pull && git switch <issue>-lane` yields both
// targets, and the switch back to the lane's own branch is the one that keeps this silent.
function switch_targets(command: string): ReadonlyArray<string> {
	return shell_segments
		.segments_of(command)
		.map((segment) => switch_target(segment))
		.filter((target): target is string => target !== undefined)
}

// The lane's own branch — `<issue>-lane` — read from the checkout path, or `undefined` when the checkout
// is not a lane. A lane child is always in a lane, so this resolves whenever the mark below does.
function own_lane_branch(directory: string): string | undefined {
	const issue = lane_paths.lane_issue_of(directory)

	return issue === undefined ? undefined : lane_paths.lane_branch(issue)
}

// True when this session is a dispatched lane child switching to a branch that is not its own. The
// command test is first, so the dispatch mark and the lane branch are read only on a real branch switch.
function is_switch_away_from_lane(
	command: string,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
	own_branch: string | undefined = own_lane_branch(process.cwd()),
): boolean {
	if (!is_lane_child || own_branch === undefined) return false

	return switch_targets(command).some((target) => target !== own_branch)
}

// The instruction in the shape a refusal can carry: what the command does, why it cannot succeed, and the
// next command to run instead. The procedure is named, not restated — its single sources are
// `backlogrun-lanes.md` and `backlogrun-child.md`, and a second copy here would be the clone `CLAUDE.md`
// prohibits. Apostrophes are avoided so the single-quoted literal needs no escaping, as the siblings do.
const LANE_SWITCH_MAIN_REASON =
	'⛔ lane child on `git switch main`: this session is a dispatched lane child, and switching to the ' +
	'default branch here always fails — a lane is a linked work tree, the primary checkout holds the ' +
	'default branch, and git allows one branch in one work tree at a time (`fatal: main is already used ' +
	'by worktree at <the primary checkout>`, measured 11 times in the 2026-09-21 backlogrun). Do not ' +
	'switch: the lane is already on its own issue branch, branched from a fresh default before it opened, ' +
	'and the latest default is brought in during the gate by `pnpm josh main:merge`. So skip this step ' +
	'and keep implementing on the current branch — no `git switch`, no `git pull`. `pnpm josh main:sync` ' +
	'(`josh ms`) is refused in a lane for the same reason, and a lane is finished with `pnpm josh ' +
	'lane:close <issue-number>`. The parent runs `git switch main && git pull` in the primary checkout ' +
	'before each lane opens, never the child — `backlogrun-lanes.md` and `backlogrun-child.md` are the ' +
	'single sources. This rule fires on every occurrence, not once per run.'

// The row itself, so `delivered-rules.ts` spreads one entry. `is_trigger` reads the input through
// `on_bash_command` — the `Bash` tool-name gate every command row shares — and `decide` returns true so
// it refuses every occurrence. It declares no `keeps`: continuing is the absence of a call, not a call,
// so the row is reported unmeasured rather than scored on an act that does not exist (`git-force.ts`).
const ROW = {
	id: 'lane-switch-main',
	is_trigger: bash_triggers.on_bash_command(is_switch_away_from_lane),
	reason: LANE_SWITCH_MAIN_REASON,
	decide: (): boolean => true,
}

const lane_switch_main = {
	LANE_SWITCH_MAIN_REASON,
	ROW,
	is_switch_away_from_lane,
	switch_target,
	switch_targets,
}

export { lane_switch_main }
