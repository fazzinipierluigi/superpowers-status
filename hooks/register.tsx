import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Attivita, Avvio, Composer, FileTracciato, Fonte, InfoAgente, Lang, Piano, TaskLibero, TaskPiano, Tempi, Todo } from '../types'
import {
  updateTimings, applyLedger, ledgerBases, timingKey, measuredDuration, isActivePhase, planEnd, taskEnd, hasCheckboxes, resolveIn, planPercent, taskPercent,
  planFromTasks, planFromTodos, planFromLedger, pruneTimings, stepPace, estimateTask, tasksFromMarkdown, tasksFromPlan, markdownTitle,
} from './parse'
import {
  TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA, PLAN_SECTION, subagentDirective, planPath, internalPrompt, superpowersPrompt,
  isSuperpowersAvailable,
} from './avvio'
import { FALLBACK, langFromName, phaseKey, translate, translator } from './i18n'
import type { MessageKey } from './i18n'
import { applyOperations, planStatus } from './spunta'
import type { Operation } from './spunta'

const PANE = 'superpowers-status'
const TITOLO = 'Superpowers status'
const SDD = '.superpowers/sdd'
const OGNI_MS = 4000
const GIORNI_RECENTI = 3
const MAX_PIANI = 3
const CHIAMATE_ATTESE = 120
const FERMO_MS = 5 * 60 * 1000
const MAX_STORICO = 20
const MAX_FILE = 5

// Cambia il tag quando cambia la forma: rifiuta i valori salvati da una versione precedente.
const piani = atom({ plugin: 'superpowers-status', key: 'piani' } as const, [] as Piano[], { shape: 'piani-2' })
const agenti = atom({ plugin: 'superpowers-status', key: 'agenti' } as const, [] as InfoAgente[], { shape: 'agenti-1' })
const attivita = atom({ plugin: 'superpowers-status', key: 'attivita' } as const, {} as Record<string, Attivita>, { shape: 'attivita-1' })
const todo = atom({ plugin: 'superpowers-status', key: 'todo' } as const, [] as Todo[], { shape: 'todo-1' })
const ora = atom({ plugin: 'superpowers-status', key: 'ora' } as const, 0, { shape: 'ora-1' })
const nascosti = atom({ plugin: 'superpowers-status', key: 'nascosti' } as const, [] as string[], { shape: 'nascosti-1' })
const tempi = atom({ plugin: 'superpowers-status', key: 'tempi' } as const, {} as Tempi, { shape: 'tempi-1' })
const taskLiberi = atom({ plugin: 'superpowers-status', key: 'taskLiberi' } as const, [] as TaskLibero[], { shape: 'task-liberi-1' })
const composer = atom({ plugin: 'superpowers-status', key: 'composer' } as const, { aperto: false, modo: 'auto' } as Composer, { shape: 'composer-1' })
const avvio = atom({ plugin: 'superpowers-status', key: 'avvio' } as const, null as Avvio | null, { shape: 'avvio-1' })
const superpowers = atom({ plugin: 'superpowers-status', key: 'superpowers' } as const, false, { shape: 'superpowers-1' })
// Task aperto per piano (nome del piano → id del task; '' nessuno): uno alla volta per piano.
const espansi = atom({ plugin: 'superpowers-status', key: 'espansi' } as const, {} as Record<string, string>, { shape: 'espansi-1' })
const MAX_ATTESA_AVVIO = 30 * 60 * 1000
const ATTESA_FILE_MS = 60 * 60 * 1000
const mostraNascosti = atom({ plugin: 'superpowers-status', key: 'mostraNascosti' } as const, false, { shape: 'mostra-1' })
const lingua = atom({ plugin: 'superpowers-status', key: 'lang' } as const, FALLBACK as Lang, { shape: 'lang-1' })

// ---------------------------------------------------------------- lingua

/** Testo nella lingua del pannello, per ciò che non si disegna (comandi, toast). */
const tr = async ($: EngineInterface, key: MessageKey, vars?: Record<string, string | number>) =>
  translate(await read($, lingua), key, vars)

/** Il campo `language` di un settings.json, se il file c'è. */
async function settingsLanguage($: EngineInterface, path: string): Promise<unknown> {
  const text = await $.fs.read(path).catch(() => '')
  if (!text) return undefined
  try { return (JSON.parse(text) as { language?: unknown }).language } catch { return undefined }
}

/**
 * Lingua delle etichette: l'opzione `language` della mod; in `auto`, l'impostazione `language` di
 * Claude Code (menu /config, poi i settings.json del progetto e dell'utente), poi la lingua del sistema.
 */
async function resolveLang($: EngineInterface, preference: unknown): Promise<Lang> {
  const chosen = preference === 'auto' ? undefined : langFromName(preference)
  if (chosen) return chosen
  try {
    const row = (await $.config.list()).find(r => /^(language|lang|locale)$/i.test(r.key))
    const l = langFromName(row?.value)
    if (l) return l
  } catch { /* menu non disponibile */ }
  const none = () => undefined
  const home = (await $.env.get('USERPROFILE').catch(none)) ?? (await $.env.get('HOME').catch(none))
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(none)) ?? (home ? `${home.replace(/[\\/]+$/, '')}/.claude` : undefined)
  const settings = ['.claude/settings.local.json', '.claude/settings.json', ...(configDir ? [`${configDir}/settings.json`] : [])]
  for (const path of settings) {
    const l = langFromName(await settingsLanguage($, path))
    if (l) return l
  }
  const locale = [
    await $.env.get('LC_ALL').catch(none),
    await $.env.get('LC_MESSAGES').catch(none),
    await $.env.get('LANG').catch(none),
    await $.env.get('LANGUAGE').catch(none),
  ]
  return locale.map(langFromName).find(Boolean) ?? FALLBACK
}

// I piani nascosti valgono anche nelle sessioni dopo: stanno in $.store, l'atom ne è la copia che ridisegna.
const CHIAVE_NASCOSTI = 'nascosti'

async function loadHidden($: EngineInterface) {
  const v = await $.store.get(CHIAVE_NASCOSTI).catch(() => undefined)
  const lista = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  await update($, nascosti, () => lista)
}

// Tempi dei task per le ETA: in $.store perché lo storico delle sessioni passate affina la stima.
const CHIAVE_TEMPI = 'tempi'

async function loadTimings($: EngineInterface) {
  const v = await $.store.get(CHIAVE_TEMPI).catch(() => undefined)
  const t = v && typeof v === 'object' && !Array.isArray(v) ? (v as Tempi) : {}
  await update($, tempi, () => t)
}

// File markdown con checkbox scritti o modificati in sessione (o salvati dal plan mode): seguiti come piani.
// $.store è uno solo per tutti i progetti: la lista sta sotto una chiave per progetto, così una sessione
// non mostra i piani di un'altra che lavora altrove. Non si filtra per cartella: il plan mode salva fuori dal progetto.
const CHIAVE_FILE_GLOBALE = 'trackedFiles'

const normalizePath = (p: string) => p.replace(/\\/g, '/').toLowerCase()

const trackedFilesKey = async ($: EngineInterface) => `trackedFiles:${normalizePath(await $.session.root())}`

async function trackedFiles($: EngineInterface): Promise<FileTracciato[]> {
  const v = await $.store.get(await trackedFilesKey($)).catch(() => undefined)
  return Array.isArray(v) ? v.filter((x): x is FileTracciato => !!x && typeof (x as FileTracciato).percorso === 'string') : []
}

async function saveTrackedFiles($: EngineInterface, lista: FileTracciato[]) {
  await $.store.set(await trackedFilesKey($), lista)
}

/** La lista di prima, comune a tutti i progetti, non si può dividere: la si scarta una volta. */
async function dropGlobalList($: EngineInterface) {
  const chiavi = await $.store.keys().catch((): string[] => [])
  if (chiavi.includes(CHIAVE_FILE_GLOBALE)) await $.store.delete(CHIAVE_FILE_GLOBALE)
}

async function trackFile($: EngineInterface, percorso: string) {
  const n = normalizePath(percorso)
  const lista = (await trackedFiles($)).filter(f => {
    const m = normalizePath(f.percorso)
    return !(m === n || m.endsWith('/' + n) || n.endsWith('/' + m))
  })
  await saveTrackedFiles($, [{ percorso, visto: Date.now() }, ...lista].slice(0, MAX_FILE))
}

// Id della sessione, per tenere separati i tempi di task e to-do di sessioni diverse.
let sessione = ''
const sessionId = async ($: EngineInterface) => (sessione ||= (await $.session.id().catch(() => 'sessione')).slice(0, 8))

async function setHidden($: EngineInterface, fn: (l: string[]) => string[]) {
  const lista = fn(await read($, nascosti))
  await update($, nascosti, () => lista)
  await $.store.set(CHIAVE_NASCOSTI, lista)
}

// Colori del tema dell'utente: seguono chiaro, scuro e daltonici.
const C = {
  accento: 'claude',
  agente: 'suggestion',
  ok: 'success',
  revisione: 'merged',
  correzioni: 'warning',
  consegnato: 'permission',
  errore: 'error',
  dim: 'inactive',
  tenue: 'subtle',
  testo: 'text',
}

const COLORE_FASE: Record<string, string> = {
  completo: C.ok,
  'in lavorazione': C.agente,
  revisione: C.revisione,
  correzioni: C.correzioni,
  consegnato: C.consegnato,
  'in coda': C.dim,
}

const formatMinutes = (ms: number) => (ms < 60000 ? Math.round(ms / 1000) + ' s' : Math.round(ms / 60000) + ' min')

const shortDuration = (ms: number) => {
  const m = Math.round(ms / 60000)
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))} s`
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

const clockTime = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const truncate = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s)

const gauge = (pct: number, w: number) => {
  const n = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
  return { on: '▰'.repeat(n), off: '▱'.repeat(w - n) }
}

async function readPlans($: EngineInterface): Promise<Piano[]> {
  const limite = Date.now() - GIORNI_RECENTI * 86400000
  const repo = await $.session.repo().catch(() => null)
  const basi = ledgerBases(await $.session.cwd(), repo?.root)
  const conRegistro: { nome: string; base: string; mtime: number }[] = []
  for (const base of basi) {
    const sdd = resolveIn(base, SDD)
    if (!(await $.fs.exists(sdd))) continue
    for (const c of (await $.fs.list(sdd)).filter(c => c.kind === 'dir')) {
      // Lo stesso registro visto dalla cwd e dalla root del repo si conta una volta.
      if (conRegistro.some(r => r.nome === c.name)) continue
      const st = await $.fs.stat(`${sdd}/${c.name}/progress.md`).catch(() => undefined)
      if (st && st.mtimeMs >= limite) conRegistro.push({ nome: c.name, base, mtime: st.mtimeMs })
    }
  }
  conRegistro.sort((a, b) => b.mtime - a.mtime)
  const out: Piano[] = []
  for (const { nome, base } of conRegistro.slice(0, MAX_PIANI)) {
    const registro = await $.fs.read(`${resolveIn(base, SDD)}/${nome}/progress.md`).catch(() => '')
    const relativo = planFromLedger(registro)
    if (!relativo) continue
    // Il piano si legge prima dalla cwd (il worktree dove si lavora), poi accanto al registro.
    const percorso = (await $.fs.exists(relativo)) ? relativo : resolveIn(base, relativo)
    const testo = await $.fs.read(percorso).catch(() => '')
    const task = applyLedger(tasksFromPlan(testo), registro)
    if (task.length) out.push({ nome, task, fonte: 'superpowers', titolo: nome, percorso })
  }
  return out
}

/** Lavoro fuori da superpowers: file markdown seguiti, lista task di Claude Code, to-do. */
async function readOtherPlans($: EngineInterface, giaMostrati: string[]): Promise<Piano[]> {
  const out: Piano[] = []
  const limite = Date.now() - GIORNI_RECENTI * 86400000
  const tenuti: FileTracciato[] = []
  const esclusi = giaMostrati.map(normalizePath)
  for (const f of await trackedFiles($)) {
    const st = await $.fs.stat(f.percorso).catch(() => undefined)
    // Un piano chiesto dal pannello non esiste ancora: lo si aspetta per un po'.
    if (!st) {
      if (Date.now() - f.visto < ATTESA_FILE_MS) tenuti.push(f)
      continue
    }
    if (st.mtimeMs < limite) continue
    tenuti.push(f)
    // Un piano superpowers già seguito dal suo registro non si mostra due volte.
    const n = normalizePath(f.percorso)
    if (esclusi.some(x => n.endsWith(x) || x.endsWith(n))) continue
    const testo = await $.fs.read(f.percorso).catch(() => '')
    const task = tasksFromMarkdown(testo)
    if (task.length) out.push({ nome: `file:${f.percorso}`, titolo: markdownTitle(testo, f.percorso), fonte: 'file', task, percorso: f.percorso })
  }
  const prima = await trackedFiles($)
  if (tenuti.length !== prima.length) await saveTrackedFiles($, tenuti)
  const sid = await sessionId($)
  const pt = planFromTasks(await read($, taskLiberi), sid)
  if (pt) out.push(pt)
  const pd = planFromTodos(await read($, todo), sid)
  if (pd) out.push(pd)
  return out
}

async function refresh($: EngineInterface) {
  try {
    const sp = await readPlans($)
    const percorsi = sp.map(x => x.percorso ?? '').filter(Boolean)
    const p: Piano[] = [...sp, ...(await readOtherPlans($, percorsi))]
    await update($, piani, () => p)
    // Il riquadro di avvio resta finché non compare un piano nuovo, o al massimo mezz'ora.
    const av = await read($, avvio)
    if (av && (p.some(x => !av.pianiPrima.includes(x.nome)) || Date.now() - av.quando > MAX_ATTESA_AVVIO)) {
      await update($, avvio, () => null)
    }
    const nuovi = updateTimings(await read($, tempi), p, Date.now())
    if (nuovi) {
      const potati = pruneTimings(nuovi, MAX_STORICO)
      await update($, tempi, () => potati)
      await $.store.set(CHIAVE_TEMPI, potati)
    }
  } catch { /* file a metà scrittura: si tiene l'ultimo valido */ }
  try {
    const lista = await $.agent.list()
    const a: InfoAgente[] = lista.map(x => ({ id: x.id, descrizione: x.description, tipo: x.type, stato: x.status }))
    await update($, agenti, () => a)
  } catch { /* nessun agente */ }
  await update($, ora, () => Date.now()).catch(() => undefined)
}

const agentsForTask = (t: TaskPiano, tutti: InfoAgente[]) =>
  tutti.filter(a =>
    t.agenti.some(id => a.id === id || a.id.startsWith(id) || id.startsWith(a.id)) ||
    new RegExp(`\\bTask\\s+${t.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(a.descrizione))

function agentPercent(a: InfoAgente, att: Attivita | undefined) {
  if (a.stato === 'completed') return 100
  const n = att?.chiamate ?? 0
  return Math.min(95, Math.round((n / CHIAMATE_ATTESE) * 100))
}

const STATI_AGENTE = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed']

function agentStatus(t: ReturnType<typeof translator>, a: InfoAgente, att: Attivita | undefined, adesso: number) {
  let s = STATI_AGENTE.includes(a.stato) ? t(`agent.${a.stato}` as MessageKey) : a.stato
  if (att) {
    s += ` · ${t('agent.ops', { n: att.chiamate })} · ${att.ultimo}`
    const fermo = adesso - att.quando
    if (a.stato === 'running' && fermo > FERMO_MS) s += ` · ${t('agent.stalled', { t: formatMinutes(fermo) })}`
    else if (a.stato === 'running') s += ` · ${t('agent.ago', { t: formatMinutes(fermo) })}`
  }
  return s
}

const agentColor = (a: InfoAgente) =>
  a.stato === 'failed' || a.stato === 'killed' ? C.errore : a.stato === 'completed' ? C.ok : C.agente

/** Avvia un nuovo piano: sceglie il flusso, prepara il prompt e lo manda alla sessione. */
async function startPlan($: EngineInterface, testo: string, modo: Composer['modo']): Promise<string> {
  const obiettivo = testo.trim()
  if (!obiettivo) return tr($, 'start.noGoal')
  const sp = await read($, superpowers)
  const via: Avvio['via'] = modo === 'interno' || !sp ? 'interno' : 'superpowers'
  const adesso = Date.now()
  const percorso = via === 'interno' ? planPath(obiettivo, adesso) : undefined
  if (percorso) await trackFile($, percorso)
  const prima = (await read($, piani)).map(p => p.nome)
  await update($, avvio, () => ({ obiettivo, via, quando: adesso, pianiPrima: prima, ...(percorso ? { percorso } : {}) }))
  await update($, composer, c => ({ ...c, aperto: false }))
  await $.prompt.submit({ text: via === 'superpowers' ? superpowersPrompt(obiettivo) : internalPrompt(obiettivo, percorso ?? '') })
  const note = modo === 'superpowers' && !sp ? await tr($, 'start.spMissingNote') : ''
  return via === 'superpowers' ? tr($, 'start.superpowers') : tr($, 'start.internal', { note, path: percorso ?? '' })
}

// ---------------------------------------------------------------- piano tenuto aggiornato dal modello

const isFinished = (p: Piano) => p.task.every(t => t.fase === 'completo')
const fileName = (p: string) => normalizePath(p).split('/').pop() ?? ''

/**
 * Il piano a cui si riferisce un testo (il prompt di un subagente): quello il cui file è citato;
 * altrimenti, senza testo o senza citazioni, il più recente con un task in corso, poi il più recente non finito.
 * `citato` dice se il testo lo nomina davvero.
 */
async function activePlan($: EngineInterface, testo = ''): Promise<{ piano: Piano; citato: boolean } | undefined> {
  const conFile = (await read($, piani)).filter(p => p.percorso)
  const t = normalizePath(testo)
  const citato = conFile.find(p => {
    const n = normalizePath(p.percorso ?? '')
    return t && (t.includes(n) || t.includes(fileName(n)))
  })
  if (citato) return { piano: citato, citato: true }
  const inCorso = conFile.find(p => !isFinished(p) && p.task.some(x => isActivePhase(x.fase)))
  const aperto = inCorso ?? conFile.find(p => !isFinished(p))
  return aperto ? { piano: aperto, citato: false } : undefined
}

/** Il task di un piano nominato in un testo: "Task N" o il titolo intero. */
function citedTask(p: Piano, testo: string): TaskPiano | undefined {
  for (const m of testo.matchAll(/\bTask\s+([\w.-]+?)[:.,)]?(?=\s|$)/gi)) {
    const t = p.task.find(x => x.id.toLowerCase() === (m[1] ?? '').toLowerCase())
    if (t) return t
  }
  const basso = testo.toLowerCase()
  return p.task.find(x => x.titolo.length >= 12 && !x.titolo.endsWith('…') && basso.includes(x.titolo.toLowerCase()))
}

/** Direttiva da aggiungere al prompt di un subagente, o undefined se non c'è un piano a cui legarlo. */
async function directiveFor($: EngineInterface, prompt: string): Promise<string | undefined> {
  if (prompt.includes('<plan-update>')) return undefined
  const a = await activePlan($, prompt)
  if (!a?.piano.percorso) return undefined
  const task = citedTask(a.piano, prompt)
  // Un piano non citato vale solo se c'è davvero lavoro in corso.
  if (!a.citato && !task && !a.piano.task.some(x => isActivePhase(x.fase))) return undefined
  return subagentDirective(a.piano.percorso, task ? { id: task.id, titolo: task.titolo } : undefined)
}

/** Esegue il tool `update_plan`: stato del piano o modifiche alle sue checkbox. */
async function updatePlan($: EngineInterface, input: { file?: string; operations?: Operation[] }): Promise<{ ok: boolean; testo: string }> {
  const file = input.file?.trim() || (await activePlan($))?.piano.percorso
  if (!file) return { ok: false, testo: 'No active plan in the panel: give `file`, the path of the plan.' }
  const prima = await $.fs.read(file).catch(() => undefined)
  if (prima === undefined) return { ok: false, testo: `Plan file not found: ${file}` }
  const ops = input.operations ?? []
  if (ops.length === 0) return { ok: true, testo: `Plan: ${file}\n${planStatus(prima)}` }
  const r = applyOperations(prima, ops)
  if (r.testo !== prima) await $.fs.write(file, r.testo)
  // Il pannello segue il file da subito, se non lo seguiva già.
  const seguiti = (await read($, piani)).map(p => normalizePath(p.percorso ?? ''))
  if (!/[\\/]\.superpowers[\\/]/.test(file) && !seguiti.some(n => n && (n.endsWith(normalizePath(file)) || normalizePath(file).endsWith(n)))) {
    await trackFile($, file)
  }
  void refresh($)
  const righe = [
    ...r.fatte.map(f => `✓ ${f}`),
    ...r.errori.map(x => `✗ ${x}`),
    '',
    planStatus(r.testo, 30),
  ]
  return { ok: r.fatte.length > 0 || r.errori.length === 0, testo: righe.join('\n') }
}

const faultKey = (surface: string, module: string) => `${surface}:${module}`

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const lang = await resolveLang($, options.language).catch(() => FALLBACK)
    await update($, lingua, () => lang)
    await $.command.register({ name: 'superpowers-status', description: translate(lang, 'cmd.status.desc') })
    void $.ui.open({ id: PANE, title: TITOLO })
    await loadHidden($)
    await loadTimings($)
    await dropGlobalList($).catch(() => undefined)
    try {
      const sp = isSuperpowersAvailable((await $.command.list()).map(c => c.name))
      await update($, superpowers, () => sp)
    } catch { /* senza elenco comandi: flusso interno */ }
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
      .catch(err => $.ui.log(`superpowers-status: tool ${TOOL_NAME} not registered: ${String(err)}`))
    await $.command.register({ name: 'new-plan', description: translate(lang, 'cmd.newPlan.desc'), argumentHint: translate(lang, 'cmd.newPlan.hint') })
    await refresh($)
    $.clock.every(OGNI_MS, () => { void refresh($) })
    return next(e)
  })

  on('command.run', { command: 'superpowers-status' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITOLO })
    return { text: await tr($, 'cmd.status.opened') }
  })

  on('command.run', { command: 'new-plan' }, async ($, e) => {
    if (!e.args.trim()) {
      await update($, composer, c => ({ ...c, aperto: true }))
      await $.ui.open({ id: PANE, title: TITOLO, focus: true })
      return { text: await tr($, 'cmd.newPlan.writeInPanel') }
    }
    return { text: await startPlan($, e.args, (await read($, composer)).modo) }
  })

  on('tool.run', { tool: 'mcp__superpowers-status__update_plan' }, async ($, e) => {
    const r = await updatePlan($, e as unknown as { file?: string; operations?: Operation[] })
    return r.ok ? { result: r.testo } : { deny: r.testo }
  }).catch(() => ({ deny: 'update_plan could not read or write the plan: edit the checkboxes directly in the file.' }))

  // L'agente principale tiene il piano aggiornato passo per passo.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (r.sections.some(x => x.id === 'superpowers-status:plan')) return r
    return { sections: [...r.sections, { id: 'superpowers-status:plan', text: PLAN_SECTION, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // Ogni subagente riceve la direttiva di spuntare i passi del piano mentre lavora, non alla fine.
    let chiamata = e
    if (e.tool === 'Agent') {
      const extra = await directiveFor($, e.prompt).catch(() => undefined)
      if (extra) chiamata = { ...e, prompt: e.prompt + extra }
    }
    const id = e.agentId
    if (id) {
      await update($, attivita, m => ({
        ...m,
        [id]: { chiamate: (m[id]?.chiamate ?? 0) + 1, ultimo: e.tool, quando: Date.now(), esito: m[id]?.esito },
      }))
    } else if (e.tool === 'TodoWrite') {
      const lista = ((e as unknown as { todos?: { content: string; status: Todo['stato'] }[] }).todos ?? [])
        .map(t => ({ testo: t.content, stato: t.status }))
      await update($, todo, () => lista)
      void refresh($)
    }
    if (e.tool === 'TaskUpdate') {
      const u = e as unknown as { taskId: string; subject?: string; description?: string; status?: TaskLibero['stato'] | 'deleted' }
      await update($, taskLiberi, l =>
        u.status === 'deleted'
          ? l.filter(t => t.id !== u.taskId)
          : l.map(t => (t.id === u.taskId
            ? { ...t, titolo: u.subject ?? t.titolo, descrizione: u.description ?? t.descrizione, stato: (u.status as TaskLibero['stato'] | undefined) ?? t.stato }
            : t)))
      void refresh($)
    }
    const r = await next(chiamata)
    // Dopo la chiamata: serve il risultato (id del task, file del piano) o il file già scritto.
    try {
      const out = (r as { result?: unknown; isError?: boolean }).isError ? undefined : (r as { result?: unknown }).result
      if (e.tool === 'TaskCreate' && out) {
        const c = e as unknown as { subject: string; description?: string }
        const id = (out as { task?: { id?: string } }).task?.id
        if (id) {
          await update($, taskLiberi, l => [...l, { id, titolo: c.subject, descrizione: c.description ?? '', stato: 'pending' as const }])
          void refresh($)
        }
      } else if (e.tool === 'ExitPlanMode' && out) {
        const f = (out as { filePath?: string }).filePath
        if (f) { await trackFile($, f); void refresh($) }
      } else if ((e.tool === 'Write' || e.tool === 'Edit') && out) {
        const f = (e as unknown as { file_path: string }).file_path
        if (/\.md$/i.test(f) && !/[\\/]\.superpowers[\\/]/.test(f) && hasCheckboxes(await $.fs.read(f).catch(() => ''))) {
          await trackFile($, f)
          void refresh($)
        }
      }
    } catch { /* il tracciamento non deve mai disturbare la chiamata */ }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      await update($, attivita, m => ({
        ...m,
        [id]: { chiamate: m[id]?.chiamate ?? 0, ultimo: m[id]?.ultimo ?? '—', quando: Date.now(), esito: e.reason },
      }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Se un modulo animato va in errore su un surface, lì lo si disegna statico; gli altri restano animati.
  const guasti = new Set<string>()
  on('ui.fault', async ($, e, next) => {
    const key = faultKey(e.surface, e.module)
    if (e.requestId === PANE && !guasti.has(key)) {
      guasti.add(key)
      $.ui.log(`superpowers-status: ${e.module} failed on ${e.surface} (${e.phase}: ${e.reason}); drawing it without animation`)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const hasClient = 'Client' in els
    const hasBar = hasClient && !guasti.has(faultKey(e.surface, 'bar.tsx'))
    const hasSpin = hasClient && !guasti.has(faultKey(e.surface, 'spinner.tsx'))
    const hasEta = hasClient && !guasti.has(faultKey(e.surface, 'eta.tsx'))
    const ps = await read($, piani)
    const ags = await read($, agenti)
    const att = await read($, attivita)
    const hidden = new Set(await read($, nascosti))
    const vediNascosti = await read($, mostraNascosti)
    const tmp = await read($, tempi)
    const comp = await read($, composer)
    const esp = await read($, espansi)
    const av = await read($, avvio)
    const sp = await read($, superpowers)
    const t = translator(await read($, lingua))
    const phaseLabel = (fase: string) => {
      const k = phaseKey(fase)
      return k ? t(k) : fase
    }
    const titleOf = (p: Piano) =>
      p.fonte === 'task' ? t('plan.sessionTasks') : p.fonte === 'todo' ? t('plan.sessionTodos') : (p.titolo ?? p.nome)
    const { msPasso, misurati } = stepPace(tmp)
    const adesso = (await read($, ora)) || Date.now()

    // Larghezza del corpo; dentro un riquadro tolgo bordo e padding.
    const W = Math.max(24, e.props.bodyColumns)
    const dentro = W - 4

    const bar = (key: string, pct: number, width: number, color: string, active: boolean) => {
      const w = Math.max(4, width)
      if (hasBar) {
        return (
          <els.Client
            key={key}
            module="./bar.tsx"
            width={w}
            height={1}
            props={{ pct, width: w, color, dim: C.tenue, shine: C.testo, active }}
          />
        )
      }
      const n = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
      return (
        <Text mono>
          <Text color={color}>{'━'.repeat(n)}</Text>
          <Text color={C.tenue}>{'─'.repeat(w - n)}</Text>
        </Text>
      )
    }

    const spinner = (key: string, color: string, active: boolean, rest: string) =>
      hasSpin ? (
        <els.Client key={key} module="./spinner.tsx" props={{ color, active, rest }} />
      ) : (
        <Text color={color}>{active ? '◐' : rest}</Text>
      )

    // Conto alla rovescia verso `fine`; senza moduli animati, il residuo fermo all'ultima lettura.
    const eta = (key: string, fine: number, color: string, suffix = '') => {
      const over = t('eta.over')
      if (hasEta) return <els.Client key={key} module="./eta.tsx" props={{ endAt: fine, now: adesso, color, warn: C.correzioni, suffix, over }} />
      const resto = fine - adesso
      return resto >= 0
        ? <Text color={color}>⏱ {shortDuration(resto)}{suffix}</Text>
        : <Text color={C.correzioni}>⏱ +{shortDuration(-resto)} {over}</Text>
    }

    // Riga con testo a sinistra (troncato) e qualcosa fisso a destra.
    const row = (sinistra: RenderChildren, destra: RenderChildren | null, width: number) => (
      <Box width={width} justifyContent="space-between" columnGap={1}>
        <Box flexShrink={1} overflow="hidden">{sinistra}</Box>
        {destra !== null && <Box flexShrink={0}>{destra}</Box>}
      </Box>
    )

    const pct = (n: number, color: string) => (
      <Text color={color} bold>{String(n).padStart(3)}%</Text>
    )

    const badge = (fase: string) => {
      const col = COLORE_FASE[fase] ?? C.dim
      return <Text color={col} bold>{isActivePhase(fase) ? `● ${phaseLabel(fase)}` : phaseLabel(fase)}</Text>
    }

    const agentRow = (a: InfoAgente, rientro: number, width: number) => {
      const at = att[a.id]
      const col = agentColor(a)
      const finito = a.stato === 'completed'
      const glifo = finito ? '✔' : a.stato === 'failed' || a.stato === 'killed' ? '✗' : '■'
      const w = width - rientro
      const barW = Math.min(12, Math.max(4, Math.floor(w / 4)))
      return (
        <Box flexDirection="column" marginLeft={rientro} width={w}>
          <Box columnGap={1}>
            {spinner(`spin-ag-${a.id}`, col, a.stato === 'running' || a.stato === 'pending', glifo)}
            <Text color={finito ? C.dim : C.testo} wrap="truncate">{a.descrizione}</Text>
          </Box>
          <Box columnGap={1} marginLeft={2}>
            {bar(`bar-ag-${a.id}`, agentPercent(a, at), barW, col, a.stato === 'running')}
            <Text color={a.stato === 'failed' ? C.errore : C.dim} wrap="truncate">{agentStatus(t, a, at, adesso)}</Text>
          </Box>
        </Box>
      )
    }

    const stepRow = (s: { testo: string; fatto: boolean }, corrente: boolean, width: number) => (
      <Box columnGap={1} marginLeft={4} width={width - 4}>
        <Text color={s.fatto ? C.ok : corrente ? C.accento : C.tenue} bold={corrente}>
          {s.fatto ? '✔' : corrente ? '▸' : '○'}
        </Text>
        <Text color={s.fatto ? C.dim : corrente ? C.testo : undefined} bold={corrente} dimColor={!s.fatto && !corrente} wrap="truncate">
          {s.testo}
        </Text>
      </Box>
    )

    // Qui `t` è il task: le etichette passano da `tx`.
    const tx = t
    const taskRow = (p: Piano, t: TaskPiano) => {
      const ok = t.fase === 'completo'
      const attivo = isActivePhase(t.fase)
      const col = COLORE_FASE[t.fase] ?? C.dim
      const pt = taskPercent(t)
      const corrente = t.passi.findIndex(s => !s.fatto)
      // In coda e completati sono una riga; se hanno passi, un clic sul titolo li apre.
      const apribile = !attivo && t.passi.length > 0
      const aperto = apribile && esp[p.nome] === t.id
      const titolo = (
        <Text color={ok ? C.dim : attivo ? C.testo : C.dim} bold={attivo} wrap="truncate">
          <Text color={attivo ? col : undefined}>{t.id}</Text> {t.titolo}
        </Text>
      )
      const testa = (
        <Box columnGap={1}>
          {ok ? <Text color={C.ok}>✔</Text> : spinner(`spin-t-${p.nome}-${t.id}`, col, attivo, '○')}
          {apribile ? (
            <Button
              key={`apri-${p.nome}-${t.id}`}
              plain
              onPress={() => void update($, espansi, m => ({ ...m, [p.nome]: m[p.nome] === t.id ? '' : t.id }))}
            >
              <Text color={C.tenue}>{aperto ? '▾' : '▸'}</Text> {titolo}
            </Button>
          ) : titolo}
        </Box>
      )
      if (!attivo) {
        const misura = ok ? measuredDuration(tmp, p.nome, timingKey(t)) : undefined
        const destra = ok
          ? misura !== undefined ? <Text color={C.tenue}>{shortDuration(misura)}</Text> : null
          : <Text color={C.tenue}>{tx('task.queued', { t: shortDuration(estimateTask(t, msPasso)) })}</Text>
        if (!aperto) return row(testa, destra, dentro)
        return (
          <Box flexDirection="column" width={dentro}>
            {row(testa, destra, dentro)}
            <Text color={C.dim}>
              {'    '}
              {ok
                ? `${tx('task.steps', { n: t.passi.length })}${misura !== undefined ? ` · ${shortDuration(misura)}` : ''}`
                : `${tx('task.steps', { n: t.passi.length })} · ${tx('task.estimateApprox', { t: shortDuration(estimateTask(t, msPasso)) })}`}
            </Text>
            {t.passi.map(s => stepRow(s, false, dentro))}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" width={dentro} marginBottom={1}>
          {row(testa, badge(t.fase), dentro)}
          <Box columnGap={1} marginLeft={2}>
            {bar(`bar-t-${p.nome}-${t.id}`, pt, dentro - 8, col, true)}
            {pct(pt, col)}
          </Box>
          <Box marginLeft={2} columnGap={1}>
            {eta(`eta-t-${p.nome}-${t.id}`, taskEnd(tmp, p.nome, t, msPasso, adesso), C.dim, tx('eta.left'))}
            <Text color={C.tenue}>/ {tx('eta.estimate', { t: shortDuration(estimateTask(t, msPasso)) })}</Text>
          </Box>
          {(p.fonte ?? 'superpowers') === 'superpowers' && agentsForTask(t, ags).map(a => agentRow(a, 2, dentro))}
          {t.passi.map((s, i) => stepRow(s, i === corrente, dentro))}
        </Box>
      )
    }

    // Etichetta della fonte del piano, nel colore che la distingue.
    const chip = (f: Fonte | undefined) => {
      const [testo, colore] = ({
        superpowers: ['SDD', C.accento], task: [t('chip.task'), C.agente], todo: [t('chip.todo'), C.consegnato], file: [t('chip.plan'), C.revisione],
      } as Record<Fonte, [string, string]>)[f ?? 'superpowers']
      return <Text color={colore} inverse bold>{` ${testo} `}</Text>
    }

    const isPlanFinished = (p: Piano) => p.task.every(t => t.fase === 'completo')

    const planCard = (p: Piano) => {
      const attivi = p.task.filter(t => isActivePhase(t.fase))
      const fatti = p.task.filter(t => t.fase === 'completo').length
      const tot = planPercent(p.task)
      const finito = isPlanFinished(p)
      const col = finito ? C.ok : C.accento
      const isNascosto = hidden.has(p.nome)
      // Un piano finito resta compatto: intestazione, barra e il bottone per toglierlo di mezzo.
      if (finito) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={col} borderDimColor paddingX={1} width={W}>
            {row(
              <Box columnGap={1}>{chip(p.fonte)}<Text color={isNascosto ? C.dim : col} bold wrap="truncate">✔ {titleOf(p)}</Text></Box>,
              <Text color={C.dim}>{t('plan.tasks', { n: p.task.length })}</Text>,
              dentro,
            )}
            <Box justifyContent="space-between" width={dentro} columnGap={1}>
              <Text color={C.dim}>
                {isNascosto ? t('plan.hidden') : t('plan.completed')}
                {(() => {
                  const d = p.task.map(t => measuredDuration(tmp, p.nome, timingKey(t))).filter((x): x is number => x !== undefined)
                  return d.length ? ` · ${shortDuration(d.reduce((a, b) => a + b, 0))}${d.length < p.task.length ? t('plan.measured') : ''}` : ''
                })()}
              </Text>
              <Button
                key={`toggle-${p.nome}`}
                plain
                dimColor
                label={isNascosto ? t('btn.restore') : t('btn.hide')}
                onPress={() => void setHidden($, l => (isNascosto ? l.filter(x => x !== p.nome) : [...l, p.nome]))}
              />
            </Box>
          </Box>
        )
      }
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={col} borderDimColor={attivi.length === 0} paddingX={1} width={W}>
          {row(
            <Box columnGap={1}>{chip(p.fonte)}<Text color={col} bold wrap="truncate">{titleOf(p)}</Text></Box>,
            <Text>
              <Text color={C.dim}>{t('plan.tasksOf', { done: fatti, n: p.task.length })} </Text>
              {pct(tot, col)}
            </Text>,
            dentro,
          )}
          {bar(`bar-p-${p.nome}`, tot, dentro, col, attivi.length > 0)}
          {(() => {
            const fine = planEnd(tmp, p, msPasso, adesso)
            if (fine === undefined) return null
            return row(
              <Box columnGap={1}>
                <Text color={C.dim}>ETA</Text>
                {eta(`eta-p-${p.nome}`, fine, col)}
                <Text color={C.dim}>· {t('eta.end', { t: clockTime(fine) })}</Text>
              </Box>,
              <Text color={C.tenue}>{misurati > 0 ? t('eta.perStep', { t: shortDuration(msPasso), n: misurati }) : t('eta.initial')}</Text>,
              dentro,
            )
          })()}
          <Box flexDirection="column" marginTop={1}>
            {p.task.map(t => taskRow(p, t))}
          </Box>
        </Box>
      )
    }

    // Subagenti già mostrati sotto un task attivo: gli altri finiscono nel loro riquadro.
    const mostrati = new Set(ps.filter(p => (p.fonte ?? 'superpowers') === 'superpowers').flatMap(p => p.task.filter(t => isActivePhase(t.fase)).flatMap(t => agentsForTask(t, ags).map(a => a.id))))
    const altri = ags.filter(a => !mostrati.has(a.id) && a.stato !== 'completed')
    const alLavoro = ags.filter(a => a.stato === 'running').length

    // Si nasconde solo ciò che è finito: un piano nascosto che riprende torna in vista da solo.
    const isHiddenPlan = (p: Piano) => hidden.has(p.nome) && isPlanFinished(p)
    const visibili = ps.filter(p => !isHiddenPlan(p))
    const nascostiQui = ps.filter(isHiddenPlan)
    const finitiVisibili = visibili.filter(isPlanFinished)


    return (
      <Box flexDirection="column" width={W}>
        <Box justifyContent="center" width={W} columnGap={1}>
          <Text color={C.accento} bold>SUPERPOWERS</Text>
          <Text color={C.tenue}>·</Text>
          <Text color={C.dim}>{t('head.plans', { n: visibili.length })}</Text>
          <Text color={C.tenue}>·</Text>
          {spinner('spin-head', C.agente, alLavoro > 0, '○')}
          <Text color={alLavoro > 0 ? C.agente : C.dim}>{t('head.working', { n: alLavoro })}</Text>
        </Box>

        <Box justifyContent="flex-end" width={W} columnGap={2}>
          <Button
            key="aggiorna"
            plain
            dimColor
            hotkey="r"
            label={t('btn.refresh')}
            onPress={() => void refresh($).then(() => $.ui.toast(t('toast.refreshed')))}
          />
          {!comp.aperto && !av && (
            <Button
              key="new-plan"
              plain
              hotkey="n"
              label={t('btn.newPlan')}
              onPress={() => void update($, composer, c => ({ ...c, aperto: true }))}
            />
          )}
        </Box>

        {comp.aperto && (() => {
          const via = comp.modo === 'interno' || !sp ? 'interno' : 'superpowers'
          const descr = via === 'superpowers'
            ? 'brainstorming → writing-plans → subagent-driven-development'
            : t('composer.internalDesc')
          const prossimo: Record<Composer['modo'], Composer['modo']> = { auto: 'superpowers', superpowers: 'interno', interno: 'auto' }
          return (
            <Box flexDirection="column" borderStyle="round" borderColor={C.accento} paddingX={1} width={W}>
              {row(<Text color={C.accento} bold>{t('composer.title')}</Text>, <Text color={C.dim}>{t('composer.enter')}</Text>, dentro)}
              {'Input' in els ? (
                // Il campo sta in un contenitore largo quanto il riquadro: il testo va a capo lì dentro e scorre.
                <Box width={dentro} overflow="hidden" flexDirection="column">
                  <els.Input
                    key="obiettivo"
                    rows={5}
                    autoFocus
                    placeholder={t('composer.placeholder')}
                    submitLabel={t('composer.submit')}
                    onSubmit={(v: string) => void startPlan($, v, comp.modo).then(t => $.ui.toast(t))}
                  />
                </Box>
              ) : (
                <Text color={C.dim}>{t('composer.noInput', { hint: t('cmd.newPlan.hint') })}</Text>
              )}
              <Box columnGap={1} marginTop={1} width={dentro}>
                {chip(via === 'superpowers' ? 'superpowers' : 'file')}
                <Text color={C.dim} wrap="truncate">{descr}</Text>
              </Box>
              {comp.modo !== 'interno' && !sp && <Text color={C.correzioni}>{t('composer.spMissing')}</Text>}
              <Box justifyContent="space-between" width={dentro} marginTop={1}>
                <Button
                  key="modo-piano"
                  plain
                  dimColor
                  label={t('composer.flow', { m: t(comp.modo === 'auto' ? 'flow.auto' : comp.modo === 'interno' ? 'flow.interno' : 'flow.superpowers') })}
                  onPress={() => void update($, composer, c => ({ ...c, modo: prossimo[c.modo] }))}
                />
                <Button key="annulla-piano" plain dimColor label={t('btn.cancel')} onPress={() => void update($, composer, c => ({ ...c, aperto: false }))} />
              </Box>
            </Box>
          )
        })()}

        {av && (
          <Box flexDirection="column" borderStyle="round" borderColor={C.revisione} paddingX={1} width={W}>
            {row(
              <Box columnGap={1}>
                {spinner('spin-avvio', C.revisione, true, '◐')}
                <Text color={C.revisione} bold>{t('launch.title')}</Text>
                {chip(av.via === 'superpowers' ? 'superpowers' : 'file')}
              </Box>,
              <Button key="chiudi-avvio" plain dimColor label="✕" onPress={() => void update($, avvio, () => null)} />,
              dentro,
            )}
            <Text wrap="truncate">{truncate(av.obiettivo.replace(/\s+/g, ' '), dentro * 2)}</Text>
            <Text color={C.dim} wrap="truncate">
              {av.via === 'superpowers' ? t('launch.waitingSp') : t('launch.waitingFile', { p: av.percorso ?? t('launch.thePlan') })}
              {t('launch.since', { t: shortDuration(Math.max(1000, adesso - av.quando)) })}
            </Text>
          </Box>
        )}

        {visibili.length === 0 && (
          <Box borderStyle="round" borderColor={C.tenue} paddingX={1} width={W}>
            <Text color={C.dim}>{ps.length === 0 ? t('empty.none') : t('empty.allHidden')}</Text>
          </Box>
        )}
        {visibili.map(planCard)}

        {(nascostiQui.length > 0 || finitiVisibili.length > 1) && (
          <Box justifyContent="flex-end" width={W} columnGap={2}>
            {finitiVisibili.length > 1 && (
              <Button
                key="nascondi-finiti"
                plain
                hotkey="f"
                label={t('btn.hideFinished', { n: finitiVisibili.length })}
                onPress={() => void setHidden($, l => [...new Set([...l, ...finitiVisibili.map(p => p.nome)])])}
              />
            )}
            {nascostiQui.length > 0 && (
              <Button
                key="mostra-nascosti"
                plain
                hotkey="h"
                label={vediNascosti ? t('btn.closeHidden') : t('btn.hiddenCount', { n: nascostiQui.length })}
                onPress={() => void update($, mostraNascosti, v => !v)}
              />
            )}
          </Box>
        )}
        {vediNascosti && nascostiQui.map(planCard)}

        {altri.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor={C.agente} paddingX={1} width={W}>
            {row(<Text color={C.agente} bold>{t('agents.others')}</Text>, <Text color={C.dim}>{altri.length}</Text>, dentro)}
            {altri.map(a => agentRow(a, 0, dentro))}
          </Box>
        )}

      </Box>
    )
  })
}
