# superpowers-status

A live side panel for [Claude Code](https://claude.com/claude-code) that tracks how your project is being built: work plans, tasks, steps, subagents, progress and ETA, all from real session events and the files in your repository.

It was born to follow plans run with the [superpowers](https://github.com/obra/superpowers) workflow (subagent-driven development), and it also tracks work done without it: plan-mode plans, markdown checklists, Claude Code's task list and to-dos.

> **Note:** the panel's interface is currently in Italian. Labels such as *in coda* (queued), *in lavorazione* (in progress), *revisione* (review), *correzioni* (fix round) and *completo* (done) are explained below.

## Features

- **Every plan in one panel**, each in its own rounded card with a source badge:
  | Badge | Source | Tasks | Steps |
  |---|---|---|---|
  | `SDD` | superpowers ledger in `.superpowers/sdd/*/progress.md` and the plan it points to | `### Task N:` | `- [ ]` / `- [x]` |
  | `PIANO` | any markdown file with checkboxes written or edited in the session, and plans saved by plan mode | `### Task N:` or `##`–`####` headings | checkboxes under them |
  | `TASK` | Claude Code's task list (`TaskCreate` / `TaskUpdate`) | each task | checkboxes in its description |
  | `TO-DO` | `TodoWrite` | each item | — |
- **Animated progress**: progress bars with a moving shine while work flows, braille spinners on active tasks and subagents, colour-coded phase badges (in progress, review, fix round, delivered).
- **ETA per task and per plan**: a live countdown for the active task (`⏱ 3:12 rimasti / stima 8 min`), an overrun warning (`+1:05 oltre stima`), an estimate for each queued task, and the plan's expected finish time (`fine ~14:32`).
- **Subagents**: each one under the task it works on, with a mini bar, its operation count, last tool and a "stalled?" hint after 5 idle minutes.
- **Expandable tasks**: click a queued or finished task to see its steps.
- **Hide finished plans**: per plan, or all at once; hidden plans can be shown again and restored, and a hidden plan that resumes comes back by itself.
- **Start a new plan from the panel**: describe what you want to achieve; the mod hands it to Claude with the right workflow (see below) and shows the plan as soon as it appears.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install superpowers-status --marketplace fazzinipierluigi/superpowers-status
```

Answer `y` to add the marketplace, then pick a scope (user scope is first; Enter takes it).

From a shell:

```
claude plugin install superpowers-status --marketplace fazzinipierluigi/superpowers-status
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `fazzinipierluigi/superpowers-status`, then **Add plugin**.

The panel opens when a session starts. It needs a Claude Code version that runs mods (plugins with a hooks module). The superpowers plugin is optional.

## Usage

| Key / command | What it does |
|---|---|
| `n` — *＋ nuovo piano* | open the box to start a new work plan; Enter launches it |
| `r` — *↻ aggiorna* | refresh everything now (the panel also refreshes every 4 s) |
| `f` | hide all finished plans |
| `h` | show / close hidden plans |
| click on a task | expand / collapse its steps |
| `/superpowers-status` | open the panel |
| `/nuovo-piano <goal>` | start a new work plan straight from the prompt |

Keys work while the panel has the focus (click it, or `ctrl+x tab`).

### Starting a new plan

The flow is picked automatically; the *flusso* button cycles automatic → superpowers → internal.

- **superpowers** (when its `writing-plans` and `subagent-driven-development` or `executing-plans` skills are installed): brainstorming → writing-plans → subagent-driven development.
- **internal** (otherwise): Claude explores the code, writes the plan to `docs/plans/YYYY-MM-DD-<slug>.md` with `### Task N:` headings and checkbox steps, then runs it task by task, ticking each step and verifying (tests/build) at the end of every task. The panel tracks that file from the start.

## How the ETA works

The superpowers ledger has no timestamps, so the mod measures time itself: it records when a task becomes active and when it completes. A step's duration is the **median** of `duration / steps` over all measured tasks; a task's estimate is `steps × that rate`.

- With no measurements yet it starts from **2 min per step**, shown as *stima iniziale*.
- Measurements are kept across sessions (last 20 plans), so the estimate improves as you work.
- A plan's ETA adds the remaining time of active tasks to the estimates of queued ones, since tasks run one after another.
- Tasks that were already complete when the mod first saw them have no measurement.

## What it stores

Using Claude Code's per-plugin store: hidden plans, measured task times and, for each project, up to 5 tracked markdown files (so a session only shows the plans of the project it works in). Nothing leaves your machine.

## Development

Clone the repository and run Claude Code with the mod loaded from its folder:

```
claude --plugin-dir ./superpowers-status
```

Claude Code writes the API types to `.claude-plugin/types/` when the mod loads; then `tsc -p .` type-checks it and `claude plugin validate .` checks the manifest and hooks.

| File | Role |
|---|---|
| `hooks/register.tsx` | hooks, data collection and the panel |
| `hooks/parse.ts` | plan, ledger and checklist parsing; ETA math |
| `hooks/avvio.ts` | new-plan flow selection and prompts |
| `hooks/bar.tsx`, `spinner.tsx`, `eta.tsx` | animated surface modules (progress bar, spinner, countdown) |
| `types/index.d.ts` | the mod's state contract |

The visual style and the animated surface-module approach are inspired by [claude-flightdeck](https://github.com/scasella/claude-flightdeck).

## License

[MIT](LICENSE) © Fazzini Pierluigi
