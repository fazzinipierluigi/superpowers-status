import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Attivita, Avvio, Composer, FileTracciato, Fonte, InfoAgente, Piano, TaskLibero, TaskPiano, Tempi, Todo } from '../types'
import {
  aggiornaTempi, applicaRegistro, basiRegistro, chiaveDi, durata, faseAttiva, finePiano, fineTask, haCheckbox, inBase, percPiano, percTask,
  pianoDaTask, pianoDaTodo, pianoDalRegistro, potaTempi, ritmo, stimaTask, taskDaMarkdown, taskDalPiano, titoloMarkdown,
} from './parse'
import { percorsoPiano, promptInterno, promptSuperpowers, superpowersDisponibile } from './avvio'

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
const piani = atom({ plugin: 'superpowers-status', key: 'piani' } as const, [] as Piano[], { shape: 'piani-1' })
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

// I piani nascosti valgono anche nelle sessioni dopo: stanno in $.store, l'atom ne è la copia che ridisegna.
const CHIAVE_NASCOSTI = 'nascosti'

async function caricaNascosti($: EngineInterface) {
  const v = await $.store.get(CHIAVE_NASCOSTI).catch(() => undefined)
  const lista = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  await update($, nascosti, () => lista)
}

// Tempi dei task per le ETA: in $.store perché lo storico delle sessioni passate affina la stima.
const CHIAVE_TEMPI = 'tempi'

async function caricaTempi($: EngineInterface) {
  const v = await $.store.get(CHIAVE_TEMPI).catch(() => undefined)
  const t = v && typeof v === 'object' && !Array.isArray(v) ? (v as Tempi) : {}
  await update($, tempi, () => t)
}

// File markdown con checkbox scritti o modificati in sessione (o salvati dal plan mode): seguiti come piani.
// $.store è uno solo per tutti i progetti: la lista sta sotto una chiave per progetto, così una sessione
// non mostra i piani di un'altra che lavora altrove. Non si filtra per cartella: il plan mode salva fuori dal progetto.
const CHIAVE_FILE_GLOBALE = 'fileTracciati'

const normale = (p: string) => p.replace(/\\/g, '/').toLowerCase()

const chiaveFile = async ($: EngineInterface) => `fileTracciati:${normale(await $.session.root())}`

async function fileTracciati($: EngineInterface): Promise<FileTracciato[]> {
  const v = await $.store.get(await chiaveFile($)).catch(() => undefined)
  return Array.isArray(v) ? v.filter((x): x is FileTracciato => !!x && typeof (x as FileTracciato).percorso === 'string') : []
}

async function salvaTracciati($: EngineInterface, lista: FileTracciato[]) {
  await $.store.set(await chiaveFile($), lista)
}

/** La lista di prima, comune a tutti i progetti, non si può dividere: la si scarta una volta. */
async function scartaListaGlobale($: EngineInterface) {
  const chiavi = await $.store.keys().catch((): string[] => [])
  if (chiavi.includes(CHIAVE_FILE_GLOBALE)) await $.store.delete(CHIAVE_FILE_GLOBALE)
}

async function traccia($: EngineInterface, percorso: string) {
  const n = normale(percorso)
  const lista = (await fileTracciati($)).filter(f => {
    const m = normale(f.percorso)
    return !(m === n || m.endsWith('/' + n) || n.endsWith('/' + m))
  })
  await salvaTracciati($, [{ percorso, visto: Date.now() }, ...lista].slice(0, MAX_FILE))
}

// Id della sessione, per tenere separati i tempi di task e to-do di sessioni diverse.
let sessione = ''
const idSessione = async ($: EngineInterface) => (sessione ||= (await $.session.id().catch(() => 'sessione')).slice(0, 8))

async function impostaNascosti($: EngineInterface, fn: (l: string[]) => string[]) {
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

const minuti = (ms: number) => (ms < 60000 ? Math.round(ms / 1000) + ' s' : Math.round(ms / 60000) + ' min')

const durataBreve = (ms: number) => {
  const m = Math.round(ms / 60000)
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))} s`
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

const orario = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const corto = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s)

const gauge = (pct: number, w: number) => {
  const n = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
  return { on: '▰'.repeat(n), off: '▱'.repeat(w - n) }
}

async function leggiPiani($: EngineInterface): Promise<Piano[]> {
  const limite = Date.now() - GIORNI_RECENTI * 86400000
  const repo = await $.session.repo().catch(() => null)
  const basi = basiRegistro(await $.session.cwd(), repo?.root)
  const conRegistro: { nome: string; base: string; mtime: number }[] = []
  for (const base of basi) {
    const sdd = inBase(base, SDD)
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
    const registro = await $.fs.read(`${inBase(base, SDD)}/${nome}/progress.md`).catch(() => '')
    const relativo = pianoDalRegistro(registro)
    if (!relativo) continue
    // Il piano si legge prima dalla cwd (il worktree dove si lavora), poi accanto al registro.
    const percorso = (await $.fs.exists(relativo)) ? relativo : inBase(base, relativo)
    const testo = await $.fs.read(percorso).catch(() => '')
    const task = applicaRegistro(taskDalPiano(testo), registro)
    if (task.length) out.push({ nome, task, fonte: 'superpowers', titolo: nome, percorso } as Piano & { percorso: string })
  }
  return out
}

/** Lavoro fuori da superpowers: file markdown seguiti, lista task di Claude Code, to-do. */
async function leggiLiberi($: EngineInterface, giaMostrati: string[]): Promise<Piano[]> {
  const out: Piano[] = []
  const limite = Date.now() - GIORNI_RECENTI * 86400000
  const tenuti: FileTracciato[] = []
  const esclusi = giaMostrati.map(normale)
  for (const f of await fileTracciati($)) {
    const st = await $.fs.stat(f.percorso).catch(() => undefined)
    // Un piano chiesto dal pannello non esiste ancora: lo si aspetta per un po'.
    if (!st) {
      if (Date.now() - f.visto < ATTESA_FILE_MS) tenuti.push(f)
      continue
    }
    if (st.mtimeMs < limite) continue
    tenuti.push(f)
    // Un piano superpowers già seguito dal suo registro non si mostra due volte.
    const n = normale(f.percorso)
    if (esclusi.some(x => n.endsWith(x) || x.endsWith(n))) continue
    const testo = await $.fs.read(f.percorso).catch(() => '')
    const task = taskDaMarkdown(testo)
    if (task.length) out.push({ nome: `file:${f.percorso}`, titolo: titoloMarkdown(testo, f.percorso), fonte: 'file', task })
  }
  const prima = await fileTracciati($)
  if (tenuti.length !== prima.length) await salvaTracciati($, tenuti)
  const sid = await idSessione($)
  const pt = pianoDaTask(await read($, taskLiberi), sid)
  if (pt) out.push(pt)
  const pd = pianoDaTodo(await read($, todo), sid)
  if (pd) out.push(pd)
  return out
}

async function rileggi($: EngineInterface) {
  try {
    const sp = await leggiPiani($)
    const percorsi = sp.map(x => (x as Piano & { percorso?: string }).percorso ?? '').filter(Boolean)
    const p: Piano[] = [...sp.map(({ nome, task, fonte, titolo }) => ({ nome, task, fonte, titolo })), ...(await leggiLiberi($, percorsi))]
    await update($, piani, () => p)
    // Il riquadro di avvio resta finché non compare un piano nuovo, o al massimo mezz'ora.
    const av = await read($, avvio)
    if (av && (p.some(x => !av.pianiPrima.includes(x.nome)) || Date.now() - av.quando > MAX_ATTESA_AVVIO)) {
      await update($, avvio, () => null)
    }
    const nuovi = aggiornaTempi(await read($, tempi), p, Date.now())
    if (nuovi) {
      const potati = potaTempi(nuovi, MAX_STORICO)
      await update($, tempi, () => potati)
      await $.store.set(CHIAVE_TEMPI, potati)
    }
  } catch { /* file a metà scrittura: si tiene l'ultimo valido */ }
  try {
    const lista = await $.agent.list()
    const a: InfoAgente[] = lista.map(x => ({ id: x.id, descrizione: x.description, tipo: x.type, stato: x.status }))
    await update($, agenti, () => a)
  } catch { /* nessun agente */ }
  await update($, ora, () => Date.now())
}

const agentiDelTask = (t: TaskPiano, tutti: InfoAgente[]) =>
  tutti.filter(a =>
    t.agenti.some(id => a.id === id || a.id.startsWith(id) || id.startsWith(a.id)) ||
    new RegExp(`\\bTask\\s+${t.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(a.descrizione))

function percAgente(a: InfoAgente, att: Attivita | undefined) {
  if (a.stato === 'completed') return 100
  const n = att?.chiamate ?? 0
  return Math.min(95, Math.round((n / CHIAMATE_ATTESE) * 100))
}

function statoAgente(a: InfoAgente, att: Attivita | undefined, adesso: number) {
  const parole: Record<string, string> = {
    pending: 'in avvio', running: 'al lavoro', waiting: 'in attesa', idle: 'inattivo',
    completed: 'finito', failed: 'fallito', killed: 'fermato',
  }
  let s = parole[a.stato] ?? a.stato
  if (att) {
    s += ` · ${att.chiamate} op · ${att.ultimo}`
    const fermo = adesso - att.quando
    if (a.stato === 'running' && fermo > FERMO_MS) s += ` · fermo da ${minuti(fermo)}?`
    else if (a.stato === 'running') s += ` · ${minuti(fermo)} fa`
  }
  return s
}

const coloreAgente = (a: InfoAgente) =>
  a.stato === 'failed' || a.stato === 'killed' ? C.errore : a.stato === 'completed' ? C.ok : C.agente

/** Avvia un nuovo piano: sceglie il flusso, prepara il prompt e lo manda alla sessione. */
async function avviaPiano($: EngineInterface, testo: string, modo: Composer['modo']): Promise<string> {
  const obiettivo = testo.trim()
  if (!obiettivo) return 'Scrivi prima l\'obiettivo del piano.'
  const sp = await read($, superpowers)
  const via: Avvio['via'] = modo === 'interno' || !sp ? 'interno' : 'superpowers'
  const adesso = Date.now()
  const percorso = via === 'interno' ? percorsoPiano(obiettivo, adesso) : undefined
  if (percorso) await traccia($, percorso)
  const prima = (await read($, piani)).map(p => p.nome)
  await update($, avvio, () => ({ obiettivo, via, quando: adesso, pianiPrima: prima, ...(percorso ? { percorso } : {}) }))
  await update($, composer, c => ({ ...c, aperto: false }))
  await $.prompt.submit({ text: via === 'superpowers' ? promptSuperpowers(obiettivo) : promptInterno(obiettivo, percorso ?? '') })
  const nota = modo === 'superpowers' && !sp ? ' (superpowers non trovato)' : ''
  return via === 'superpowers' ? 'Nuovo piano avviato con superpowers.' : `Nuovo piano avviato con il flusso interno${nota}: ${percorso}`
}

const faultKey = (surface: string, module: string) => `${surface}:${module}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'superpowers-status', description: 'Apre il pannello con piani, task, subagenti e to-do' })
    void $.ui.open({ id: PANE, title: TITOLO })
    await caricaNascosti($)
    await caricaTempi($)
    await scartaListaGlobale($).catch(() => undefined)
    try {
      const sp = superpowersDisponibile((await $.command.list()).map(c => c.name))
      await update($, superpowers, () => sp)
    } catch { /* senza elenco comandi: flusso interno */ }
    await $.command.register({ name: 'nuovo-piano', description: 'Avvia un nuovo piano di lavoro (superpowers se c\'è, altrimenti flusso interno)', argumentHint: '<obiettivo>' })
    await rileggi($)
    $.clock.every(OGNI_MS, () => { void rileggi($) })
    return next(e)
  })

  on('command.run', { command: 'superpowers-status' }, async $ => {
    await rileggi($)
    await $.ui.open({ id: PANE, title: TITOLO })
    return { text: 'Pannello Superpowers status aperto.' }
  })

  on('command.run', { command: 'nuovo-piano' }, async ($, e) => {
    if (!e.args.trim()) {
      await update($, composer, c => ({ ...c, aperto: true }))
      await $.ui.open({ id: PANE, title: TITOLO, focus: true })
      return { text: 'Scrivi l\'obiettivo nel pannello Superpowers status.' }
    }
    return { text: await avviaPiano($, e.args, (await read($, composer)).modo) }
  })

  on('tool.call', async ($, e, next) => {
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
      void rileggi($)
    }
    if (e.tool === 'TaskUpdate') {
      const u = e as unknown as { taskId: string; subject?: string; description?: string; status?: TaskLibero['stato'] | 'deleted' }
      await update($, taskLiberi, l =>
        u.status === 'deleted'
          ? l.filter(t => t.id !== u.taskId)
          : l.map(t => (t.id === u.taskId
            ? { ...t, titolo: u.subject ?? t.titolo, descrizione: u.description ?? t.descrizione, stato: (u.status as TaskLibero['stato'] | undefined) ?? t.stato }
            : t)))
      void rileggi($)
    }
    const r = await next(e)
    // Dopo la chiamata: serve il risultato (id del task, file del piano) o il file già scritto.
    try {
      const out = (r as { result?: unknown; isError?: boolean }).isError ? undefined : (r as { result?: unknown }).result
      if (e.tool === 'TaskCreate' && out) {
        const c = e as unknown as { subject: string; description?: string }
        const id = (out as { task?: { id?: string } }).task?.id
        if (id) {
          await update($, taskLiberi, l => [...l, { id, titolo: c.subject, descrizione: c.description ?? '', stato: 'pending' as const }])
          void rileggi($)
        }
      } else if (e.tool === 'ExitPlanMode' && out) {
        const f = (out as { filePath?: string }).filePath
        if (f) { await traccia($, f); void rileggi($) }
      } else if ((e.tool === 'Write' || e.tool === 'Edit') && out) {
        const f = (e as unknown as { file_path: string }).file_path
        if (/\.md$/i.test(f) && !/[\\/]\.superpowers[\\/]/.test(f) && haCheckbox(await $.fs.read(f).catch(() => ''))) {
          await traccia($, f)
          void rileggi($)
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
      $.ui.log(`superpowers-status: ${e.module} in errore su ${e.surface} (${e.phase}: ${e.reason}); lo disegno senza animazione`)
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
    const { msPasso, misurati } = ritmo(tmp)
    const adesso = (await read($, ora)) || Date.now()

    // Larghezza del corpo; dentro un riquadro tolgo bordo e padding.
    const W = Math.max(24, e.props.bodyColumns)
    const dentro = W - 4

    const barra = (key: string, pct: number, width: number, color: string, active: boolean) => {
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
      if (hasEta) return <els.Client key={key} module="./eta.tsx" props={{ endAt: fine, now: adesso, color, warn: C.correzioni, suffix }} />
      const resto = fine - adesso
      return resto >= 0
        ? <Text color={color}>⏱ {durataBreve(resto)}{suffix}</Text>
        : <Text color={C.correzioni}>⏱ +{durataBreve(-resto)} oltre stima</Text>
    }

    // Riga con testo a sinistra (troncato) e qualcosa fisso a destra.
    const riga = (sinistra: RenderChildren, destra: RenderChildren | null, width: number) => (
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
      return <Text color={col} bold>{faseAttiva(fase) ? `● ${fase}` : fase}</Text>
    }

    const rigaAgente = (a: InfoAgente, rientro: number, width: number) => {
      const at = att[a.id]
      const col = coloreAgente(a)
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
            {barra(`bar-ag-${a.id}`, percAgente(a, at), barW, col, a.stato === 'running')}
            <Text color={a.stato === 'failed' ? C.errore : C.dim} wrap="truncate">{statoAgente(a, at, adesso)}</Text>
          </Box>
        </Box>
      )
    }

    const rigaPasso = (s: { testo: string; fatto: boolean }, corrente: boolean, width: number) => (
      <Box columnGap={1} marginLeft={4} width={width - 4}>
        <Text color={s.fatto ? C.ok : corrente ? C.accento : C.tenue} bold={corrente}>
          {s.fatto ? '✔' : corrente ? '▸' : '○'}
        </Text>
        <Text color={s.fatto ? C.dim : corrente ? C.testo : undefined} bold={corrente} dimColor={!s.fatto && !corrente} wrap="truncate">
          {s.testo}
        </Text>
      </Box>
    )

    const rigaTask = (p: Piano, t: TaskPiano) => {
      const ok = t.fase === 'completo'
      const attivo = faseAttiva(t.fase)
      const col = COLORE_FASE[t.fase] ?? C.dim
      const pt = percTask(t)
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
        const misura = ok ? durata(tmp, p.nome, chiaveDi(t)) : undefined
        const destra = ok
          ? misura !== undefined ? <Text color={C.tenue}>{durataBreve(misura)}</Text> : null
          : <Text color={C.tenue}>in coda · ~{durataBreve(stimaTask(t, msPasso))}</Text>
        if (!aperto) return riga(testa, destra, dentro)
        return (
          <Box flexDirection="column" width={dentro}>
            {riga(testa, destra, dentro)}
            <Text color={C.dim}>
              {'    '}
              {ok
                ? `${t.passi.length} passi${misura !== undefined ? ` · ${durataBreve(misura)}` : ''}`
                : `${t.passi.length} passi · stima ~${durataBreve(stimaTask(t, msPasso))}`}
            </Text>
            {t.passi.map(s => rigaPasso(s, false, dentro))}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" width={dentro} marginBottom={1}>
          {riga(testa, badge(t.fase), dentro)}
          <Box columnGap={1} marginLeft={2}>
            {barra(`bar-t-${p.nome}-${t.id}`, pt, dentro - 8, col, true)}
            {pct(pt, col)}
          </Box>
          <Box marginLeft={2} columnGap={1}>
            {eta(`eta-t-${p.nome}-${t.id}`, fineTask(tmp, p.nome, t, msPasso, adesso), C.dim, ' rimasti')}
            <Text color={C.tenue}>/ stima {durataBreve(stimaTask(t, msPasso))}</Text>
          </Box>
          {(p.fonte ?? 'superpowers') === 'superpowers' && agentiDelTask(t, ags).map(a => rigaAgente(a, 2, dentro))}
          {t.passi.map((s, i) => rigaPasso(s, i === corrente, dentro))}
        </Box>
      )
    }

    // Etichetta della fonte del piano, nel colore che la distingue.
    const chip = (f: Fonte | undefined) => {
      const [testo, colore] = ({
        superpowers: ['SDD', C.accento], task: ['TASK', C.agente], todo: ['TO-DO', C.consegnato], file: ['PIANO', C.revisione],
      } as Record<Fonte, [string, string]>)[f ?? 'superpowers']
      return <Text color={colore} inverse bold>{` ${testo} `}</Text>
    }

    const pianoFinito = (p: Piano) => p.task.every(t => t.fase === 'completo')

    const riquadroPiano = (p: Piano) => {
      const attivi = p.task.filter(t => faseAttiva(t.fase))
      const fatti = p.task.filter(t => t.fase === 'completo').length
      const tot = percPiano(p.task)
      const finito = pianoFinito(p)
      const col = finito ? C.ok : C.accento
      const isNascosto = hidden.has(p.nome)
      // Un piano finito resta compatto: intestazione, barra e il bottone per toglierlo di mezzo.
      if (finito) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={col} borderDimColor paddingX={1} width={W}>
            {riga(
              <Box columnGap={1}>{chip(p.fonte)}<Text color={isNascosto ? C.dim : col} bold wrap="truncate">✔ {p.titolo ?? p.nome}</Text></Box>,
              <Text color={C.dim}>{p.task.length} task</Text>,
              dentro,
            )}
            <Box justifyContent="space-between" width={dentro} columnGap={1}>
              <Text color={C.dim}>
                {isNascosto ? 'nascosto' : 'completato'}
                {(() => {
                  const d = p.task.map(t => durata(tmp, p.nome, chiaveDi(t))).filter((x): x is number => x !== undefined)
                  return d.length ? ` · ${durataBreve(d.reduce((a, b) => a + b, 0))}${d.length < p.task.length ? ' misurati' : ''}` : ''
                })()}
              </Text>
              <Button
                key={`toggle-${p.nome}`}
                plain
                dimColor
                label={isNascosto ? '↺ ripristina' : '✕ nascondi'}
                onPress={() => void impostaNascosti($, l => (isNascosto ? l.filter(x => x !== p.nome) : [...l, p.nome]))}
              />
            </Box>
          </Box>
        )
      }
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={col} borderDimColor={attivi.length === 0} paddingX={1} width={W}>
          {riga(
            <Box columnGap={1}>{chip(p.fonte)}<Text color={col} bold wrap="truncate">{p.titolo ?? p.nome}</Text></Box>,
            <Text>
              <Text color={C.dim}>{fatti}/{p.task.length} task </Text>
              {pct(tot, col)}
            </Text>,
            dentro,
          )}
          {barra(`bar-p-${p.nome}`, tot, dentro, col, attivi.length > 0)}
          {(() => {
            const fine = finePiano(tmp, p, msPasso, adesso)
            if (fine === undefined) return null
            return riga(
              <Box columnGap={1}>
                <Text color={C.dim}>ETA</Text>
                {eta(`eta-p-${p.nome}`, fine, col)}
                <Text color={C.dim}>· fine ~{orario(fine)}</Text>
              </Box>,
              <Text color={C.tenue}>{misurati > 0 ? `${durataBreve(msPasso)}/passo · ${misurati} misurati` : 'stima iniziale'}</Text>,
              dentro,
            )
          })()}
          <Box flexDirection="column" marginTop={1}>
            {p.task.map(t => rigaTask(p, t))}
          </Box>
        </Box>
      )
    }

    // Subagenti già mostrati sotto un task attivo: gli altri finiscono nel loro riquadro.
    const mostrati = new Set(ps.filter(p => (p.fonte ?? 'superpowers') === 'superpowers').flatMap(p => p.task.filter(t => faseAttiva(t.fase)).flatMap(t => agentiDelTask(t, ags).map(a => a.id))))
    const altri = ags.filter(a => !mostrati.has(a.id) && a.stato !== 'completed')
    const alLavoro = ags.filter(a => a.stato === 'running').length

    // Si nasconde solo ciò che è finito: un piano nascosto che riprende torna in vista da solo.
    const isNascosto = (p: Piano) => hidden.has(p.nome) && pianoFinito(p)
    const visibili = ps.filter(p => !isNascosto(p))
    const nascostiQui = ps.filter(isNascosto)
    const finitiVisibili = visibili.filter(pianoFinito)


    return (
      <Box flexDirection="column" width={W}>
        <Box justifyContent="center" width={W} columnGap={1}>
          <Text color={C.accento} bold>SUPERPOWERS</Text>
          <Text color={C.tenue}>·</Text>
          <Text color={C.dim}>{visibili.length} {visibili.length === 1 ? 'piano' : 'piani'}</Text>
          <Text color={C.tenue}>·</Text>
          {spinner('spin-head', C.agente, alLavoro > 0, '○')}
          <Text color={alLavoro > 0 ? C.agente : C.dim}>{alLavoro} al lavoro</Text>
        </Box>

        <Box justifyContent="flex-end" width={W} columnGap={2}>
          <Button
            key="aggiorna"
            plain
            dimColor
            hotkey="r"
            label="↻ aggiorna"
            onPress={() => void rileggi($).then(() => $.ui.toast('Pannello aggiornato.'))}
          />
          {!comp.aperto && !av && (
            <Button
              key="nuovo-piano"
              plain
              hotkey="n"
              label="＋ nuovo piano"
              onPress={() => void update($, composer, c => ({ ...c, aperto: true }))}
            />
          )}
        </Box>

        {comp.aperto && (() => {
          const via = comp.modo === 'interno' || !sp ? 'interno' : 'superpowers'
          const descr = via === 'superpowers'
            ? 'brainstorming → writing-plans → subagent-driven-development'
            : 'piano in docs/plans con checkbox, eseguito e spuntato passo per passo'
          const prossimo: Record<Composer['modo'], Composer['modo']> = { auto: 'superpowers', superpowers: 'interno', interno: 'auto' }
          return (
            <Box flexDirection="column" borderStyle="round" borderColor={C.accento} paddingX={1} width={W}>
              {riga(<Text color={C.accento} bold>＋ Nuovo piano di lavoro</Text>, <Text color={C.dim}>Invio per avviare</Text>, dentro)}
              {'Input' in els ? (
                // Il campo sta in un contenitore largo quanto il riquadro: il testo va a capo lì dentro e scorre.
                <Box width={dentro} overflow="hidden" flexDirection="column">
                  <els.Input
                    key="obiettivo"
                    rows={5}
                    autoFocus
                    placeholder="Cosa vuoi ottenere?"
                    submitLabel="avvia"
                    onSubmit={(v: string) => void avviaPiano($, v, comp.modo).then(t => $.ui.toast(t))}
                  />
                </Box>
              ) : (
                <Text color={C.dim}>Qui non c'è un campo di testo: usa /nuovo-piano &lt;obiettivo&gt;</Text>
              )}
              <Box columnGap={1} marginTop={1} width={dentro}>
                {chip(via === 'superpowers' ? 'superpowers' : 'file')}
                <Text color={C.dim} wrap="truncate">{descr}</Text>
              </Box>
              {comp.modo !== 'interno' && !sp && <Text color={C.correzioni}>superpowers non trovato: uso il flusso interno</Text>}
              <Box justifyContent="space-between" width={dentro} marginTop={1}>
                <Button
                  key="modo-piano"
                  plain
                  dimColor
                  label={`flusso: ${comp.modo === 'auto' ? 'automatico' : comp.modo}`}
                  onPress={() => void update($, composer, c => ({ ...c, modo: prossimo[c.modo] }))}
                />
                <Button key="annulla-piano" plain dimColor label="✕ annulla" onPress={() => void update($, composer, c => ({ ...c, aperto: false }))} />
              </Box>
            </Box>
          )
        })()}

        {av && (
          <Box flexDirection="column" borderStyle="round" borderColor={C.revisione} paddingX={1} width={W}>
            {riga(
              <Box columnGap={1}>
                {spinner('spin-avvio', C.revisione, true, '◐')}
                <Text color={C.revisione} bold>Avvio piano</Text>
                {chip(av.via === 'superpowers' ? 'superpowers' : 'file')}
              </Box>,
              <Button key="chiudi-avvio" plain dimColor label="✕" onPress={() => void update($, avvio, () => null)} />,
              dentro,
            )}
            <Text wrap="truncate">{corto(av.obiettivo.replace(/\s+/g, ' '), dentro * 2)}</Text>
            <Text color={C.dim} wrap="truncate">
              {av.via === 'superpowers' ? 'in attesa del piano: brainstorming → writing-plans' : `in attesa di ${av.percorso ?? 'il piano'}`}
              {` · da ${durataBreve(Math.max(1000, adesso - av.quando))}`}
            </Text>
          </Box>
        )}

        {visibili.length === 0 && (
          <Box borderStyle="round" borderColor={C.tenue} paddingX={1} width={W}>
            <Text color={C.dim}>{ps.length === 0 ? 'Nessun piano superpowers recente in questo progetto.' : 'Tutti i piani recenti sono nascosti.'}</Text>
          </Box>
        )}
        {visibili.map(riquadroPiano)}

        {(nascostiQui.length > 0 || finitiVisibili.length > 1) && (
          <Box justifyContent="flex-end" width={W} columnGap={2}>
            {finitiVisibili.length > 1 && (
              <Button
                key="nascondi-finiti"
                plain
                hotkey="f"
                label={`nascondi ${finitiVisibili.length} finiti`}
                onPress={() => void impostaNascosti($, l => [...new Set([...l, ...finitiVisibili.map(p => p.nome)])])}
              />
            )}
            {nascostiQui.length > 0 && (
              <Button
                key="mostra-nascosti"
                plain
                hotkey="h"
                label={vediNascosti ? 'chiudi nascosti' : `${nascostiQui.length} nascosti`}
                onPress={() => void update($, mostraNascosti, v => !v)}
              />
            )}
          </Box>
        )}
        {vediNascosti && nascostiQui.map(riquadroPiano)}

        {altri.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor={C.agente} paddingX={1} width={W}>
            {riga(<Text color={C.agente} bold>Altri subagenti</Text>, <Text color={C.dim}>{altri.length}</Text>, dentro)}
            {altri.map(a => rigaAgente(a, 0, dentro))}
          </Box>
        )}

      </Box>
    )
  })
}
