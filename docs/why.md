# Why kit exists

AI coding is great fun for the first week. The trouble starts **around month two on the same project** — and it is not about how capable the model is, it is about how the work is run.

kit is what came out of fixing those snags one at a time, until the fixes had become a package. Read only the sections that sound familiar.

> These mechanisms are for **projects that use Node tooling** (the `full` profile). An HTML/CSS-only site or a project in another language (the `basic` profile) gets the minimum: short AI rules plus formatting, Git and editor settings. What each profile gets is in [overview.md](./overview.md).

## Working with an AI agent

### I keep repeating the same instructions

#### Sound familiar?

You wrote it in the rules file and it still isn't followed, so you write it again in more detail. The file grows until **nobody reads it, and it eats the context.** One day the rules run to thousands of lines and there is no room left to read the actual code.

#### What kit does

The rules file says only **when a rule fires and where its details live**; the procedures themselves live outside it, as skills that are **loaded only at the moment that work begins.**

Starting an implementation loads the implementation procedure; updating dependencies loads the dependency procedure. **Nothing carries everything all the time.** The rules and skills add up to 68 files and about 98,000 words, yet one piece of work reads only a small part of them.

And because kit is a package, `josh sync` brings every project up to the latest rules — you say it once, in one place.

### The agent does things I never asked for

#### Sound familiar?

- A commit you didn't ask for
- A merge into `main` you didn't ask for
- `git add` **wiping out the staging you had carefully built**
- "While I was at it, I also fixed…" files unrelated to the request
- A force push or a deleted branch (there goes your day)

#### What kit does

**Dangerous operations are physically blocked by deny rules**: force push, branch deletion, index operations including `git add`, `git reset`, PR merges, `rm -rf`, `sudo`. Shared-state changes nobody asked for simply cannot run.

On top of that, **a workflow never starts unless you type its keyword.** A conversational request like "clear the backlog" or "implement this" does not start one — and the agent is forbidden from asking "shall I run it?", **because a yes to that question would be a back door.** If you want it to run, you type the keyword. That's all.

### Reviewing every change is a chore

#### Sound familiar?

The agent writes fast, so the diffs pile up faster than you can read them. You either skim and merge, or **you become the bottleneck.**

#### What kit does

**The agent reviews its own diff before every commit**, with a fresh reviewer that has not seen the implementation. High and medium findings must be fixed before the commit; the review runs at most two rounds, the second only verifying the fixes. A merge is refused when no review record exists for the tree being merged.

What reaches you is the result — and the places where kit decided [a human eye is needed](#some-changes-need-a-human-eye).

### I can't tell if the agent is stuck or done

#### Sound familiar?

You come back after 30 minutes to find **it asked a question in minute three and has been waiting ever since.** Or you leave it alone thinking it's still running, and it finished long ago. You can't tell without going to look.

#### What kit does

**Anything that needs you reaches your phone on Telegram.**

- **When it stops**: before stopping to wait for your decision, it must send a notification.
- **When it finishes or fails**: both are notified.
- **When nobody has picked up the work**: if runnable work is sitting idle, you hear about it before you ask.
- **While it runs**: a long run with no notification writes its progress to the session screen periodically — not to your phone, because routine pings would bury the notifications that matter.

If your phone is quiet, it's not your turn yet. But if the session or the machine dies, no notification goes out either — after a long silence, check the progress on screen.

### AI costs keep climbing

#### Sound familiar?

Every request re-sends everything the session has read so far. A long session or a bloated rules file **quietly multiplies the bill**, and the most expensive model ends up doing the simplest steps.

#### What kit does

- **Rules load only when needed**: procedures are skills read at the moment their work begins, and long documents are read section by section, so the context each request carries stays small.
- **Light steps go to a cheaper model**: `josh delegate` says whether a step may go to a cheaper tier — only steps whose mistakes the parent catches cheaply qualify; judgement stays with the stronger model.
- **Sessions are cut when context gets expensive**: `josh cost` measures the input each request carries and says when starting fresh pays for itself.

## Working on GitHub

### Wiring AI up to GitHub is a chore

#### Sound familiar?

Branch, push, open a PR, link the Issue, wait for CI, merge, close the Issue. Getting an agent to do all of that reliably means **writing your own scripts and prompts — again, in every repository.**

#### What kit does

**One keyword covers the whole path.** `josh start` sets a project up for the Issue workflow — including the GitHub repository. From there `fullrun` goes Issue → branch → PR → merge: `josh pr` writes the `closes #N` link so the Issue closes itself, and `josh followup` waits for CI and merges only when it is green. GitHub is driven through the `gh` CLI, which is all you need to install.

### Writing Issues is a chore

#### Sound familiar?

You know an Issue-driven flow is the right way to work with an agent. But writing the title, the background and the acceptance criteria every time **feels like more work than the change itself.**

#### What kit does

**`kickoff new` turns the conversation into the Issue.** It derives the title, files the Issue in a fixed template, posts the plan, and stops for you to read. Before filing, it scans for an existing Issue that covers the same work and [stops rather than filing a duplicate](#the-backlog-fills-with-duplicate-issues). Filing always goes through `josh issue:file`, so every Issue meets the same bar.

### Big requests come back sloppy

#### Sound familiar?

Ask for a big feature in one go and the direction drifts halfway, tests go missing, and the diff is too big to review. **The bigger the request, the rougher the result.**

#### What kit does

**Work moves in Issue-sized pieces.**

- **Plan before starting**: `kickoff` writes what will change and how into the Issue, then stops. Implementation reads that first.
- **One Issue = one PR = one verification**: every change passes the gate and the review, so a diff stays a size you can read.
- **Split when too big**: when the work separates into independently shippable parts and exceeds one verification (roughly 10 files or 400 lines), kit creates child Issues under an epic and stops; `backlogrun` works through them later. The split decision uses the same criteria every time, and the default is not to split.

### I spend all day talking to the agent

#### Sound familiar?

Explain one task, wait for it, check it, explain the next… **You spend more time talking to the agent than the agent spends working.** And there are 30 Issues, but you hand them over one at a time — **sorting out which comes first and which is waiting on what is still your job.**

#### What kit does

**You only talk about the plan.** Work the plan out with `kickoff`, leave it on the Issue, and add the approval label. Then type `backlogrun` once, and **it works through several Issues in dependency order.**

You don't decide the order or what can run side by side either. One command sorts the whole backlog into "runnable now", "waiting on something", "waiting for a human decision" and "out of scope", with dependencies resolved — even across repositories, where kit knows **a dependency in another repository is satisfied only once it is published, not when its Issue closes.** Implementation, verification, review and merge are the agent's; you look at the results and at the decisions it asks you for.

### I want many Issues solved at once

#### Sound familiar?

One tool call, wait, another call. While tests run, the agent just waits. However many Issues there are, they go one at a time. **Each step is quick, yet the whole thing is slow.**

#### What kit does

**Less waiting, and everything that can run in parallel does.**

- **Independent Issues run side by side**: Issues that don't depend on each other run at once, up to the number of free lanes in each repository. An Issue fixing a defect in kit's own verification that makes unrelated PRs answer wrongly on `main` today carries a solo label and runs alone.
- **Calls that can go together go in one turn**: three turns in a row of single calls are stopped on the spot.
- **Work continues while waiting**: verification runs concurrently, and long commands run in the background while the review proceeds.

### Some changes need a human eye

#### Sound familiar?

Some changes can't be judged by tests passing — the quality of published prose, or which of several options to pick. Yet once they are on the automated track, **they reach a merge without anyone looking.**

#### What kit does

**A label only humans apply (`needs-human-review`).** An Issue carrying it is implemented and run through the verification gate as usual, but then **stops without committing, leaves the working tree as it is, and notifies you.** You look at it and, if it's good, the run continues from there. You can place "a human looks here" inside the automation.

### One task overwrote another's work

#### Sound familiar?

You give the agent a new task, and **the uncommitted changes from the previous one are gone.** When two tasks run in the same working tree, the later one happily tramples the earlier state.

#### What kit does

**A workflow that implements claims the working tree as its very first step.** If another task is using it, kit says which one and stops. The claim holds until the work ends — including while it waits before a commit for your check — **because the uncommitted changes are exactly what needs protecting.**

### A session cut off and I lost track

#### Sound familiar?

The context runs out in the middle of a long task. You try to resume, but **neither you nor the agent knows what finished and where to pick up.** So it starts over.

#### What kit does

**Progress lives on GitHub, not in the session.** Which Issues are done, what is waiting, how much budget is left — all recorded in the repository, so a run picks up where it stopped even after the session ends.

And **a `backlogrun` that is cut and resumed counts as the same request continuing, not a new one** — you don't have to type the keyword again. A single-Issue run that is cut waits for you to type its keyword again.

### The backlog fills with duplicate Issues

#### Sound familiar?

You let the agent file what it notices along the way, and **three Issues say the same thing in different words.** The backlog only grows, and cleaning it up is your job again.

#### What kit does

**Every filing checks the existing Issues for a duplicate first.** A duplicate is folded into the existing Issue instead of filed, and a related epic takes it in. A filing that skips the check is stopped on the spot.

And **when more than 30 Issues are open, nothing new is filed until one is closed.** If nothing can honestly be closed, the filing is dropped. The only exceptions are a filing the work itself needs, and an interrupt such as a verification giving a wrong answer or data being lost.

## Writing TypeScript

### Done doesn't mean done

#### Sound familiar?

- "Implementation complete" — **and not a single test was added**
- "This should pass" — it doesn't
- "Done" with lint errors still on the screen
- "Refactored" — and nobody checked that nothing broke

This is the part that wears you down most. **If you have to check everything yourself anyway, handing it over only saved you half the work.**

#### What kit does

**Compliance is decided by a command, not by the agent's own report.**

- **Verification is one command**: lint, type checking, spell checking and unit tests run concurrently. "It should pass" is not an answer.
- **A commit without a test is refused**: kit reads the changed files and decides whether the change needs a test; if one is needed and missing, the commit stops. A docs-only change is exempt, and kit tells the two apart on its own.
- **Refactoring starts with tests**: pin the existing behavior first, then change the code — that order is a rule.

The point is that **kit stopped writing "please be careful" into prompts.** Instead of asking for care, it makes the careless path impassable.

### Quality slips with every change

#### Sound familiar?

It works. But the function is 200 lines long, naming changes from file to file, and the same logic is pasted in three places. Point it out and it gets fixed — **then the next file does the same thing.**

#### What kit does

**The quality bar ships as tool configuration, not as a request.**

- **ESLint**: caps on complexity, length, nesting depth and parameter count; magic numbers and `any` are banned, and kit adds rules of its own.
- **Prettier and cspell**: formatting and spelling are uniform, so diffs don't churn over style.
- **Coding conventions**: naming and file layout rules, plus a "refactor first, then proceed" step on every change.

All of it is judged by the verification gate, so as long as a violation remains, the work is not "done".

### Updating dependencies keeps breaking things

#### Sound familiar?

You ask the agent to bring the packages up to date. One update quietly lowers another, **a version you pinned on purpose is gone**, and the audit never ran. So the updates get put off — until they pile up.

#### What kit does

**One command updates everything, and the pins survive.**

- **One step**: `josh latest` updates every dependency, runs the security audit, then updates pnpm.
- **Never backwards**: it never lowers a version; when an update would, it restores the lockfile.
- **Pins are left alone**: overridden and held-back packages are skipped and listed, and the agent must confirm the pins survived before it reports the update.
- **Fix forward**: when a bump breaks the build, the fix goes forward; pinning back is the last resort, and the reason is recorded.

## What happens when it all fits together

Everything so far is about "fewer accidents". Stack enough of it, though, and **something changes in kind.**

**Once you no longer have to check every output, the agent can run while nobody is watching.**

Type one keyword and the agent **starts working through the approved Issues in dependency order.** For each one it plans, implements, passes the verification gate, reviews itself, opens a PR, waits for CI to go green, and merges. Then the next one, and the next. Whatever can run in parallel does.

When it hits something that needs a decision, **it sets that aside and moves on instead of stopping.** What needs a human is marked and left for you. Progress and completion arrive as notifications. A cut session resumes where it stopped.

**And the agent can only touch Issues a human has given the approval label (`auto-ok`)** — or Issues under an epic carrying it. The agent never labels an existing Issue itself. The one exception is the Issues the agent discovers while working on approved ones: those inherit the label by default, unless they need a human's judgement, and even that is capped by count and budget. **Deciding what the agent may do stays a human job, to the very end.**

## The most important part: it ships as a package

If you read this far thinking "I built something like this in my own repository", you're not alone — so did I. **The problem is that it only lives in that one repository.** The moment you have two or three projects, the system you grew becomes copies and degraded copies.

kit **ships it as a package.**

Add it as a devDependency and initialize, and the rules, the verification scripts and the deny rules for dangerous operations all reach that project. The procedure skills arrive as a Claude Code plugin, with nothing to install. Update kit and the sync command brings the project along. **The same keyword works the same way in every project.** (Everything above reaches a `full`-profile project; a `basic` project gets only short rules and minimal formatting and Git settings.)

For scale: there are 162 `josh` commands, and **111 of them are meant to be run by the agent, not by a person.** That is what it means to be built with the agent as the primary user, rather than having AI support bolted on later.

## What to know up front

- **It assumes you work from GitHub Issues.** It doesn't fit a style of development that never writes one.
- **It needs the `gh` CLI.** GitHub operations go through `gh api`.
- **Not every rule is enforced by a command.** Dangerous git operations, commits without a test, and merges with no self-review record (or a review that read a different working tree) are stopped by commands; others — such as never applying the approval label, or never changing pinned versions on its own — are held by prompt rules and an after-the-fact check.
- **Deciding which Issues to hand to the agent stays with you.** That is not automated, and it won't be.
- It isn't magic. **kit does not make the agent smarter; it makes it possible to hand work over without having to trust the agent.**

You don't have to trust it to hand it the work. That is all kit is.
