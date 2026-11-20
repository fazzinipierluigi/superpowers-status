import { expect, test } from 'claude-code/testing'

import { applyOperations, planStatus } from '../hooks/spunta'
import { absolutePath, trackedCopyOf } from '../hooks/parse'

const PIANO = [
  '# Piano di prova',
  '',
  '### Task 1: Parser',
  '- [ ] Scrivere il test',
  '- [ ] Implementare il parser',
  '```md',
  '- [ ] esempio dentro il codice',
  '```',
  '',
  '### Task 2: Interfaccia del pannello',
  '- [ ] Disegnare la barra',
  '- [ ] Collegare gli eventi',
  '',
].join('\n')

test('spunta un passo per numero e per testo', async () => {
  const r = applyOperations(PIANO, [{ task: '1', step: 1 }, { task: 'Task 2', step: 'eventi' }])
  expect(r.errori).toEqual([])
  expect(r.testo).toContain('- [x] Scrivere il test')
  expect(r.testo).toContain('- [x] Collegare gli eventi')
  expect(r.testo).toContain('- [ ] Implementare il parser')
  // Le checkbox nei blocchi di codice non sono passi.
  expect(r.testo).toContain('- [ ] esempio dentro il codice')
})

test('senza passo spunta tutto il task; done: false toglie la spunta', async () => {
  const r = applyOperations(PIANO, [{ task: 'interfaccia' }, { task: '2', step: 1, done: false }])
  expect(r.testo).toContain('- [ ] Disegnare la barra')
  expect(r.testo).toContain('- [x] Collegare gli eventi')
})

test('aggiunge e rinomina passi', async () => {
  const r = applyOperations(PIANO, [{ task: '1', add: 'Aggiornare il README' }, { task: '1', step: 2, text: 'Implementare il lexer' }])
  expect(r.errori).toEqual([])
  expect(r.testo).toContain('- [ ] Implementare il lexer\n- [ ] Aggiornare il README\n```md')
})

test('errori chiari per task e passi inesistenti', async () => {
  const r = applyOperations(PIANO, [{ task: '9', step: 1 }, { task: '1', step: 7 }])
  expect(r.testo).toBe(PIANO)
  expect(r.errori.length).toBe(2)
})

test('lo stato indica il prossimo passo', async () => {
  const s = planStatus(applyOperations(PIANO, [{ task: '1', step: 1 }]).testo)
  expect(s).toContain('Progress: 1/4 steps.')
  expect(s).toContain('Next: Task 1, step 2: Implementare il parser')
})

test('il tool spunta il file e il prompt dei subagenti riceve la direttiva', async ($, on) => {
  const FILE = 'docs/plans/2026-11-19-prova.md'
  let testo = PIANO.replace('- [ ] Scrivere il test', '- [x] Scrivere il test')
  on('command.register', () => ({ value: { command: 'x' } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', () => ({ value: { tool: 'mcp__superpowers-status__update_plan' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'sessione-di-prova' }))
  on('store.keys', () => ({ value: [] }))
  on('store.get', (_, e) => ({ value: String(e.key).startsWith('trackedFiles:') ? [{ percorso: FILE, visto: Date.now() }] : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', () => ({ value: { mtimeMs: Date.now(), size: testo.length, kind: 'file', isLink: false } }))
  on('fs.read', () => ({ value: testo }))
  const scritti: string[] = []
  on('fs.write', (_, e) => { scritti.push(String(e.path)); testo = e.text; return { value: undefined } })
  on('agent.list', () => ({ value: [] }))
  let promptVisto = ''
  on('tool.call', (_, e) => {
    if (e.tool === 'Agent') promptVisto = e.prompt
    return { result: {} }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const r = await $.tool.call({ tool: 'mcp__superpowers-status__update_plan', file: FILE, operations: [{ task: '1', step: 2 }] })
  expect(String((r as { result?: unknown }).result)).toContain('ticked')
  expect(testo).toContain('- [x] Implementare il parser')

  await $.tool.call({ tool: 'Agent', description: 'Task 2', prompt: 'Implementa il Task 2: Interfaccia del pannello.' })
  expect(promptVisto).toContain('<plan-update>')
  expect(promptVisto).toContain(FILE)
  expect(promptVisto).toContain('task: "2"')
  // Percorso assoluto nel checkout principale, e divieto esplicito di spuntare la copia del worktree.
  expect(promptVisto).toContain('/repo/' + FILE)
  expect(promptVisto).toContain('do NOT tick, edit or commit the copy of the plan inside your worktree')

  // Un subagente che spunta la copia nel suo worktree viene reindirizzato al piano del pannello.
  const copia = '/repo/.claude/worktrees/agent-1/' + FILE
  const r2 = await $.tool.call({ tool: 'mcp__superpowers-status__update_plan', file: copia, operations: [{ task: '2', step: 1 }] })
  expect(String((r2 as { result?: unknown }).result)).toContain('is a copy of the tracked plan')
  // Il motore risolve il percorso a modo suo (su Windows con l'unità): conta che sia il piano del checkout principale.
  expect((scritti[scritti.length - 1] ?? '').replace(/\\/g, '/').endsWith('/repo/' + FILE)).toBe(true)
  expect(testo).toContain('- [x] Disegnare la barra')
})

test('percorsi assoluti e copie dei piani nei worktree', async () => {
  expect(absolutePath('C:\\repo', 'docs/p.md')).toBe('C:/repo/docs/p.md')
  expect(absolutePath('/repo', '/altro/p.md')).toBe('/altro/p.md')
  const seguiti = ['/repo/docs/plans/p.md']
  expect(trackedCopyOf('/repo/.worktrees/t1/docs/plans/p.md', seguiti, ['/repo'])).toBe('/repo/docs/plans/p.md')
  expect(trackedCopyOf('/repo/docs/plans/p.md', seguiti, ['/repo'])).toBe(undefined)
  expect(trackedCopyOf('/repo/docs/plans/altro.md', seguiti, ['/repo'])).toBe(undefined)
  expect(trackedCopyOf('docs/plans/p.md', seguiti, ['/repo'])).toBe(undefined)
})
