// Avvio di un nuovo piano di lavoro dal pannello: scelta del flusso e testo del prompt.

export type Via = 'superpowers' | 'interno'

/** Skill superpowers che servono al flusso completo: scrittura del piano ed esecuzione. */
export function isSuperpowersAvailable(comandi: string[]): boolean {
  const has = (n: string) => comandi.some(c => c === `superpowers:${n}`)
  return has('writing-plans') && (has('subagent-driven-development') || has('executing-plans'))
}

export const slug = (testo: string) =>
  testo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-') || 'plan'

const isoDate = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Dove il flusso interno scrive il piano: il pannello lo segue da subito. */
export const planPath = (obiettivo: string, adesso: number) => `docs/plans/${isoDate(adesso)}-${slug(obiettivo)}.md`

// The prompts and texts below are read by the model: they are in English whatever the panel's
// language, and the model answers the person in their own language.

export function superpowersPrompt(goal: string): string {
  return [
    'New work plan requested from the Superpowers status panel.',
    '',
    'Goal:',
    goal,
    '',
    'Follow the superpowers workflow, one skill after the other:',
    '1. superpowers:brainstorming: clarify requirements and design, asking the questions you need.',
    '2. superpowers:writing-plans: write the plan with a `### Task N: title` heading per task and the steps as `- [ ]` checkboxes.',
    '3. Run the plan with superpowers:subagent-driven-development (ledger in .superpowers/sdd); if subagents are not available, with superpowers:executing-plans.',
    '4. Keep the plan up to date step by step with the `mcp__superpowers-status__update_plan` tool: every step is ticked as soon as it is done, by you and by the subagents (put the plan file and the task number in each subagent\'s prompt).',
  ].join('\n')
}

export function internalPrompt(goal: string, path: string): string {
  return [
    'New work plan requested from the Superpowers status panel.',
    '',
    'Goal:',
    goal,
    '',
    'Proceed as follows:',
    '1. Explore the code just enough to know where to work; ask questions only if you cannot proceed without an answer.',
    `2. Write the plan to \`${path}\`: a \`# ...\` title, then for each task a \`### Task N: title\` heading followed by its steps as \`- [ ] ...\` checkboxes, small and verifiable.`,
    '3. Run the tasks in order. As soon as you complete a step, tick it with the `mcp__superpowers-status__update_plan` tool (or by changing `- [ ]` to `- [x]` in the file): the panel reads progress and computes the ETA from there.',
    '4. At the end of each task, verify (tests, build or an equivalent check) before moving on; if something fails, fix it first.',
  ].join('\n')
}

// ---------------------------------------------------------------- plan kept up to date

/** The tool the model uses to tick and update the plan's steps. */
export const TOOL_NAME = 'update_plan'
export const PLAN_TOOL = 'mcp__superpowers-status__update_plan'

export const TOOL_DESCRIPTION = [
  'Ticks and updates the steps of a markdown work plan (tasks as `### Task N:` or headings, steps as `- [ ]` / `- [x]`).',
  'The Superpowers status panel reads the file to show progress and ETA: call it AS SOON AS you complete a step, one at a time, not at the end of the task.',
  '',
  'Without `operations` it returns the plan\'s state: tasks, numbered steps and the next step to do.',
  'Each operation: `task` (number, "Task 3" or part of the title) and `step` (number from 1 within the task, or part of its text).',
  '- tick: `{ task: "3", step: 2 }` (`done: false` unticks it); without `step` it applies to every step of the task.',
  '- rename: `{ task: "3", step: 2, text: "new text" }`.',
  '- add: `{ task: "3", add: "step text" }` (at the end of the task, or after `step`).',
  '`file` is the plan\'s path; when missing, the panel\'s active plan is used.',
].join('\n')

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'Path of the plan file (relative to the working directory, or absolute). Missing: the active plan.' },
    operations: {
      type: 'array',
      description: 'Changes, applied in order. Missing or empty: only returns the state.',
      items: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task number ("3"), "Task 3" or part of its title.' },
          step: { type: ['integer', 'string'], description: 'Step number within the task (from 1) or part of its text.' },
          done: { type: 'boolean', description: 'true ticked (default), false to do.' },
          text: { type: 'string', description: 'New text for the given step.' },
          add: { type: 'string', description: 'Adds a to-do step with this text.' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const

/** System prompt section for the main agent: the plan is kept up to date step by step. */
export const PLAN_SECTION = [
  '# Tracked work plan (Superpowers status)',
  'A panel shows the progress of work plans live by reading the checkboxes of their markdown files (superpowers plans, plan mode, `docs/plans/*.md`, any `- [ ]` checklist). When you run such a plan:',
  `- As soon as you complete a step, tick it right away with the \`${PLAN_TOOL}\` tool (or by changing \`- [ ]\` to \`- [x]\` in the file). Never batch the ticks at the end of a task: the panel would stand still.`,
  '- If the plan changes (steps added, split, renamed or dropped), update it with the same tool before going on.',
  '- When you delegate a task to a subagent, put the plan file\'s path and the task number in its prompt: it ticks the steps itself as it completes them. When it returns, check the plan\'s state and tick whatever is missing.',
].join('\n')

/** Directive appended to every subagent's prompt while a plan is in progress. */
export function subagentDirective(path: string, task?: { id: string; titolo: string }): string {
  const where = task ? `Task ${task.id} ("${task.titolo}") of the plan \`${path}\`` : `the plan \`${path}\``
  return [
    '',
    '',
    '<plan-update>',
    `This work is part of ${where}, whose progress is shown live in a panel.`,
    `While you work, as soon as you complete each step, tick it RIGHT AWAY with the \`${PLAN_TOOL}\` tool (file: \`${path}\`${task ? `, task: "${task.id}"` : ''}), one step at a time. Do not wait until the end: ticking everything at once when you finish makes the tracking useless.`,
    `If the tool is not available, edit the file directly, changing \`- [ ]\` to \`- [x]\` on the step's line. If you find new or obsolete steps, update the plan the same way. Only tick the steps of ${task ? 'your task' : 'the work assigned to you'}.`,
    '</plan-update>',
  ].join('\n')
}
