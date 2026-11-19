# superpowers-status

A live side panel for [Claude Code](https://claude.com/claude-code) that tracks how your project is being built: work plans, tasks, steps, subagents, progress and ETA, all from real session events and the files in your repository.

It was born to follow plans run with the [superpowers](https://github.com/obra/superpowers) workflow (subagent-driven development), and it also tracks work done without it: plan-mode plans, markdown checklists, Claude Code's task list and to-dos.

> **Languages:** the panel speaks Italian, English, Spanish, German, French and Russian. By default it follows Claude Code's `language` setting, then the system locale (English otherwise); see [Language](#language). The examples below are in English.

## Features

- **Every plan in one panel**, each in its own rounded card with a source badge:
  | Badge | Source | Tasks | Steps |
  |---|---|---|---|
  | `SDD` | superpowers ledger in `.superpowers/sdd/*/progress.md` and the plan it points to | `### Task N:` | `- [ ]` / `- [x]` |
  | `PIANO` | any markdown file with checkboxes written or edited in the session, and plans saved by plan mode | `### Task N:` or `##`–`####` headings | checkboxes under them |
  | `TASK` | Claude Code's task list (`TaskCreate` / `TaskUpdate`) | each task | checkboxes in its description |
  | `TO-DO` | `TodoWrite` | each item | — |
- **Animated progress**: progress bars with a moving shine while work flows, braille spinners on active tasks and subagents, colour-coded phase badges (in progress, review, fix round, delivered).
- **ETA per task and per plan**: a live countdown for the active task (`⏱ 3:12 left / estimate 8 min`), an overrun warning (`+1:05 over estimate`), an estimate for each queued task, and the plan's expected finish time (`ends ~14:32`).
- **Subagents**: each one under the task it works on, with a mini bar, its operation count, last tool and a "stalled?" hint after 5 idle minutes.
- **Expandable tasks**: click a queued or finished task to see its steps.
- **Hide finished plans**: per plan, or all at once; hidden plans can be shown again and restored, and a hidden plan that resumes comes back by itself.
- **Start a new plan from the panel**: describe what you want to achieve; the mod hands it to Claude with the right workflow (see below) and shows the plan as soon as it appears.
- **Plans kept up to date step by step**: the mod gives Claude an `update_plan` tool to tick, untick, rename and add plan steps, tells the main agent to tick each step the moment it is done, and injects the same directive (with the plan file and task number) into every subagent it dispatches, so the panel moves while a subagent works instead of jumping when it returns.
- **Six languages**: Italian, English, Spanish, German, French and Russian labels, picked from Claude Code's language setting or the mod's `language` option.

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
| `n` — *＋ new plan* | open the box to start a new work plan; Enter launches it |
| `r` — *↻ refresh* | refresh everything now (the panel also refreshes every 4 s) |
| `f` | hide all finished plans |
| `h` | show / close hidden plans |
| click on a task | expand / collapse its steps |
| `/superpowers-status` | open the panel |
| `/new-plan <goal>` | start a new work plan straight from the prompt |

Keys work while the panel has the focus (click it, or `ctrl+x tab`).

> **Upgrading from 1.0:** `/nuovo-piano` is now `/new-plan`.

### Starting a new plan

The flow is picked automatically; the *flow* button cycles automatic → superpowers → internal.

- **superpowers** (when its `writing-plans` and `subagent-driven-development` or `executing-plans` skills are installed): brainstorming → writing-plans → subagent-driven development.
- **internal** (otherwise): Claude explores the code, writes the plan to `docs/plans/YYYY-MM-DD-<slug>.md` with `### Task N:` headings and checkbox steps, then runs it task by task, ticking each step and verifying (tests/build) at the end of every task. The panel tracks that file from the start.

## Keeping the plan up to date

Without help, a plan run by subagents stays frozen in the panel until each subagent returns, then jumps ahead in one go. The mod prevents that in three ways:

- **`update_plan` tool** (`mcp__superpowers-status__update_plan`): with no `operations` it returns the plan's state (tasks, numbered steps, next step); each operation names a `task` (number, `Task 3` or part of the title) and a `step` (number within the task or part of its text), and ticks it (`done: false` unticks it), renames it (`text`) or adds a new step (`add`). `file` defaults to the panel's active plan. Checkboxes inside code blocks are left alone.
- **Main agent**: a section of the system prompt asks it to tick each step as soon as it is done, to update the plan when it changes, and to pass the plan file and task number to every subagent.
- **Subagents**: every `Agent` call made while a plan is in progress gets a `<plan-update>` block appended to its prompt, naming the plan file and, when the prompt mentions it, the task; the subagent ticks its steps as it goes (by the tool, or by editing the file if the tool is not available to it).

## Language

The labels of the panel, its commands and its notifications come in six languages: Italian (`it`), English (`en`), Spanish (`es`), German (`de`), French (`fr`) and Russian (`ru`).

The mod's `language` option (in `/config`, or in `settings.json` under `pluginConfigs["superpowers-status"].options.language`) picks one; `auto`, the default, uses in order:

1. Claude Code's `language` setting (the `/config` row, then the project's and the user's `settings.json`), as a code or a name (`it`, `Italiano`, `German`, `русский`…);
2. the system locale (`LC_ALL`, `LC_MESSAGES`, `LANG`, `LANGUAGE`);
3. English.

What the model reads (the system prompt section, the subagent directive, the `update_plan` tool's description and results, the prompts `/new-plan` sends) is always in English, whatever the panel's language; Claude still answers you in your own language.

The texts are in `hooks/i18n.ts`; adding a language means adding it to `Lang` in `types/index.d.ts` and a column to that table (the tests check that every label has every language).

## How the ETA works

The superpowers ledger has no timestamps, so the mod measures time itself: it records when a task becomes active and when it completes. A step's duration is the **median** of `duration / steps` over all measured tasks; a task's estimate is `steps × that rate`.

- With no measurements yet it starts from **2 min per step**, shown as *initial estimate*.
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
| `hooks/avvio.ts` | new-plan flow selection and prompts; plan-update tool spec and directives |
| `hooks/i18n.ts` | panel labels in six languages; language detection |
| `hooks/spunta.ts` | tick / rename / add plan steps; plan state summary |
| `tests/*.test.ts` | tests (`claude plugin test .`) |
| `hooks/bar.tsx`, `spinner.tsx`, `eta.tsx` | animated surface modules (progress bar, spinner, countdown) |
| `types/index.d.ts` | the mod's state contract |

The visual style and the animated surface-module approach are inspired by [claude-flightdeck](https://github.com/scasella/claude-flightdeck).

## License

[MIT](LICENSE) © Fazzini Pierluigi
