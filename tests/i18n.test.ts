import { expect, test } from 'claude-code/testing'

import { ALL_KEYS, LANGS, entryOf, langFromName, translate } from '../hooks/i18n'

test('ogni etichetta esiste in tutte le lingue, con gli stessi segnaposto', async () => {
  for (const key of ALL_KEYS) {
    const entry = entryOf(key)
    const segnaposto = (v: unknown) => JSON.stringify(v).match(/\{\w+\}/g)?.sort().filter((x, i, a) => a.indexOf(x) === i) ?? []
    const attesi = segnaposto(entry.it)
    for (const lang of LANGS) {
      expect(entry[lang]).toBeDefined()
      expect(segnaposto(entry[lang])).toEqual(attesi)
    }
  }
})

test('plurali, russo compreso', async () => {
  expect(translate('it', 'head.plans', { n: 1 })).toBe('1 piano')
  expect(translate('it', 'head.plans', { n: 3 })).toBe('3 piani')
  expect(translate('en', 'task.steps', { n: 1 })).toBe('1 step')
  expect(translate('de', 'head.plans', { n: 2 })).toBe('2 Pläne')
  expect(translate('ru', 'head.plans', { n: 1 })).toBe('1 план')
  expect(translate('ru', 'head.plans', { n: 3 })).toBe('3 плана')
  expect(translate('ru', 'head.plans', { n: 5 })).toBe('5 планов')
  expect(translate('ru', 'head.plans', { n: 11 })).toBe('11 планов')
  expect(translate('ru', 'head.plans', { n: 21 })).toBe('21 план')
})

test('lingua da codici, locale e nomi', async () => {
  expect(langFromName('it')).toBe('it')
  expect(langFromName('de_DE.UTF-8')).toBe('de')
  expect(langFromName('Italiano')).toBe('it')
  expect(langFromName('spanish')).toBe('es')
  expect(langFromName('Français')).toBe('fr')
  expect(langFromName('русский')).toBe('ru')
  expect(langFromName('English')).toBe('en')
  expect(langFromName('auto')).toBeUndefined()
  expect(langFromName('japanese')).toBeUndefined()
})

const PANE = {
  plugin: 'superpowers-status',
  component: 'Pane',
  requestId: 'superpowers-status',
  props: { title: 'Superpowers status', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

for (const [language, atteso] of [['en', 'No recent plans in this project.'], ['de', 'Keine aktuellen Pläne in diesem Projekt.']] as const) {
  test(`il pannello parla ${language} se l'opzione lo chiede`, { options: { language } }, async ($, on) => {
    on('command.register', () => ({ value: { command: 'x' } }))
    on('command.list', () => ({ value: [] }))
    on('tool.register', () => ({ value: { tool: 'mcp__superpowers-status__update_plan' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: '/repo' }))
    on('session.cwd', () => ({ value: '/repo' }))
    on('session.id', () => ({ value: 'sessione' }))
    on('store.keys', () => ({ value: [] }))
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('fs.exists', () => ({ value: false }))
    on('agent.list', () => ({ value: [] }))

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Text', text: atteso }))?.text).toBe(atteso)
      await ui.unmount()
    }
  })
}
