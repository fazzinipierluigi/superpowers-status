// Etichette del pannello in più lingue: italiano, inglese, spagnolo, tedesco, francese, russo.

import type { Lang } from '../types'

export type { Lang }
export const LANGS: readonly Lang[] = ['it', 'en', 'es', 'de', 'fr', 'ru']
export const FALLBACK: Lang = 'en'

/** Forme plurali: `one` e `other` ovunque; il russo usa anche `few` e `many`. */
type Plural = { one: string; other: string; few?: string; many?: string }
type Text = string | Plural
type Entry = Record<Lang, Text>

/** Lingua da un codice o un nome ("it", "it_IT.UTF-8", "Italiano", "German", "русский"…). */
export function langFromName(value: unknown): Lang | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim().toLowerCase()
  if (!v) return undefined
  const code = v.match(/^([a-z]{2})(?:[-_.@]|$)/)?.[1]
  if (code && (LANGS as readonly string[]).includes(code)) return code as Lang
  const names: [Lang, RegExp][] = [
    ['it', /^(ital)/],
    ['en', /^(engl|ingl|angl)/],
    ['es', /^(span|espa|spagn|castell)/],
    ['de', /^(germ|deut|tedes|alem|allem)/],
    ['fr', /^(fren|fran|franc)/],
    ['ru', /^(russ|rus|русск|рус)/],
  ]
  return names.find(([, re]) => re.test(v))?.[0]
}

function pluralForm(lang: Lang, n: number): keyof Plural {
  if (lang === 'ru') {
    const d = n % 10, c = n % 100
    if (d === 1 && c !== 11) return 'one'
    if (d >= 2 && d <= 4 && (c < 12 || c > 14)) return 'few'
    return 'many'
  }
  if (lang === 'fr') return n === 0 || n === 1 ? 'one' : 'other'
  return n === 1 ? 'one' : 'other'
}

const M = {
  // comandi
  'cmd.status.desc': {
    it: 'Apre il pannello con piani, task, subagenti e to-do',
    en: 'Opens the panel with plans, tasks, subagents and to-dos',
    es: 'Abre el panel con planes, tareas, subagentes y pendientes',
    de: 'Öffnet das Panel mit Plänen, Aufgaben, Subagenten und To-dos',
    fr: 'Ouvre le panneau des plans, tâches, sous-agents et to-do',
    ru: 'Открывает панель с планами, задачами, субагентами и списком дел',
  },
  'cmd.status.opened': {
    it: 'Pannello Superpowers status aperto.',
    en: 'Superpowers status panel opened.',
    es: 'Panel Superpowers status abierto.',
    de: 'Panel Superpowers status geöffnet.',
    fr: 'Panneau Superpowers status ouvert.',
    ru: 'Панель Superpowers status открыта.',
  },
  'cmd.newPlan.desc': {
    it: 'Avvia un nuovo piano di lavoro (superpowers se c\'è, altrimenti flusso interno)',
    en: 'Starts a new work plan (superpowers if available, otherwise the internal flow)',
    es: 'Inicia un nuevo plan de trabajo (superpowers si está disponible; si no, el flujo interno)',
    de: 'Startet einen neuen Arbeitsplan (superpowers, falls vorhanden, sonst der interne Ablauf)',
    fr: 'Lance un nouveau plan de travail (superpowers s\'il est disponible, sinon le flux interne)',
    ru: 'Запускает новый план работ (superpowers, если доступен, иначе встроенный процесс)',
  },
  'cmd.newPlan.hint': { it: '<obiettivo>', en: '<goal>', es: '<objetivo>', de: '<ziel>', fr: '<objectif>', ru: '<цель>' },
  'cmd.newPlan.writeInPanel': {
    it: 'Scrivi l\'obiettivo nel pannello Superpowers status.',
    en: 'Write the goal in the Superpowers status panel.',
    es: 'Escribe el objetivo en el panel Superpowers status.',
    de: 'Schreib das Ziel in das Panel Superpowers status.',
    fr: 'Écris l\'objectif dans le panneau Superpowers status.',
    ru: 'Напишите цель в панели Superpowers status.',
  },

  // avvio di un piano
  'start.noGoal': {
    it: 'Scrivi prima l\'obiettivo del piano.',
    en: 'Write the plan\'s goal first.',
    es: 'Escribe primero el objetivo del plan.',
    de: 'Schreib zuerst das Ziel des Plans.',
    fr: 'Écris d\'abord l\'objectif du plan.',
    ru: 'Сначала напишите цель плана.',
  },
  'start.superpowers': {
    it: 'Nuovo piano avviato con superpowers.',
    en: 'New plan started with superpowers.',
    es: 'Nuevo plan iniciado con superpowers.',
    de: 'Neuer Plan mit superpowers gestartet.',
    fr: 'Nouveau plan lancé avec superpowers.',
    ru: 'Новый план запущен через superpowers.',
  },
  'start.internal': {
    it: 'Nuovo piano avviato con il flusso interno{note}: {path}',
    en: 'New plan started with the internal flow{note}: {path}',
    es: 'Nuevo plan iniciado con el flujo interno{note}: {path}',
    de: 'Neuer Plan mit dem internen Ablauf gestartet{note}: {path}',
    fr: 'Nouveau plan lancé avec le flux interne{note} : {path}',
    ru: 'Новый план запущен встроенным процессом{note}: {path}',
  },
  'start.spMissingNote': {
    it: ' (superpowers non trovato)',
    en: ' (superpowers not found)',
    es: ' (superpowers no encontrado)',
    de: ' (superpowers nicht gefunden)',
    fr: ' (superpowers introuvable)',
    ru: ' (superpowers не найден)',
  },

  // fasi dei task
  'phase.completo': { it: 'completo', en: 'done', es: 'completado', de: 'fertig', fr: 'terminé', ru: 'готово' },
  'phase.in lavorazione': { it: 'in lavorazione', en: 'in progress', es: 'en curso', de: 'in Arbeit', fr: 'en cours', ru: 'в работе' },
  'phase.revisione': { it: 'revisione', en: 'review', es: 'revisión', de: 'Review', fr: 'revue', ru: 'ревью' },
  'phase.correzioni': { it: 'correzioni', en: 'fix round', es: 'correcciones', de: 'Korrekturen', fr: 'corrections', ru: 'исправления' },
  'phase.consegnato': { it: 'consegnato', en: 'delivered', es: 'entregado', de: 'geliefert', fr: 'livré', ru: 'сдано' },
  'phase.in coda': { it: 'in coda', en: 'queued', es: 'en cola', de: 'in Warteschlange', fr: 'en attente', ru: 'в очереди' },

  // subagenti
  'agent.pending': { it: 'in avvio', en: 'starting', es: 'iniciando', de: 'startet', fr: 'démarrage', ru: 'запуск' },
  'agent.running': { it: 'al lavoro', en: 'working', es: 'trabajando', de: 'arbeitet', fr: 'au travail', ru: 'работает' },
  'agent.waiting': { it: 'in attesa', en: 'waiting', es: 'esperando', de: 'wartet', fr: 'en attente', ru: 'ожидает' },
  'agent.idle': { it: 'inattivo', en: 'idle', es: 'inactivo', de: 'untätig', fr: 'inactif', ru: 'простаивает' },
  'agent.completed': { it: 'finito', en: 'finished', es: 'terminado', de: 'fertig', fr: 'terminé', ru: 'завершён' },
  'agent.failed': { it: 'fallito', en: 'failed', es: 'fallido', de: 'fehlgeschlagen', fr: 'échoué', ru: 'ошибка' },
  'agent.killed': { it: 'fermato', en: 'stopped', es: 'detenido', de: 'gestoppt', fr: 'arrêté', ru: 'остановлен' },
  'agent.ops': { it: '{n} op', en: '{n} ops', es: '{n} op', de: '{n} Op', fr: '{n} op', ru: '{n} оп' },
  'agent.stalled': {
    it: 'fermo da {t}?', en: 'stalled for {t}?', es: '¿parado hace {t}?', de: 'seit {t} still?', fr: 'bloqué depuis {t} ?', ru: 'стоит {t}?',
  },
  'agent.ago': { it: '{t} fa', en: '{t} ago', es: 'hace {t}', de: 'vor {t}', fr: 'il y a {t}', ru: '{t} назад' },
  'agents.others': {
    it: 'Altri subagenti', en: 'Other subagents', es: 'Otros subagentes', de: 'Weitere Subagenten', fr: 'Autres sous-agents', ru: 'Другие субагенты',
  },

  // tempi e stime
  'eta.over': {
    it: 'oltre stima', en: 'over estimate', es: 'sobre lo estimado', de: 'über Schätzung', fr: 'au-delà de l\'estimation', ru: 'сверх оценки',
  },
  'eta.left': { it: ' rimasti', en: ' left', es: ' restantes', de: ' übrig', fr: ' restants', ru: ' осталось' },
  'eta.estimate': { it: 'stima {t}', en: 'estimate {t}', es: 'estimado {t}', de: 'Schätzung {t}', fr: 'estimation {t}', ru: 'оценка {t}' },
  'eta.initial': {
    it: 'stima iniziale', en: 'initial estimate', es: 'estimación inicial', de: 'erste Schätzung', fr: 'estimation initiale', ru: 'начальная оценка',
  },
  'eta.perStep': {
    it: '{t}/passo · {n} misurati', en: '{t}/step · {n} measured', es: '{t}/paso · {n} medidos',
    de: '{t}/Schritt · {n} gemessen', fr: '{t}/étape · {n} mesurés', ru: '{t}/шаг · измерено: {n}',
  },
  'eta.end': { it: 'fine ~{t}', en: 'ends ~{t}', es: 'fin ~{t}', de: 'Ende ~{t}', fr: 'fin ~{t}', ru: 'конец ~{t}' },

  // task e piani
  'task.queued': { it: 'in coda · ~{t}', en: 'queued · ~{t}', es: 'en cola · ~{t}', de: 'wartet · ~{t}', fr: 'en attente · ~{t}', ru: 'в очереди · ~{t}' },
  'task.steps': {
    it: { one: '{n} passo', other: '{n} passi' },
    en: { one: '{n} step', other: '{n} steps' },
    es: { one: '{n} paso', other: '{n} pasos' },
    de: { one: '{n} Schritt', other: '{n} Schritte' },
    fr: { one: '{n} étape', other: '{n} étapes' },
    ru: { one: '{n} шаг', few: '{n} шага', many: '{n} шагов', other: '{n} шагов' },
  },
  'task.estimateApprox': { it: 'stima ~{t}', en: 'estimate ~{t}', es: 'estimado ~{t}', de: 'Schätzung ~{t}', fr: 'estimation ~{t}', ru: 'оценка ~{t}' },
  'plan.tasks': {
    it: { one: '{n} task', other: '{n} task' },
    en: { one: '{n} task', other: '{n} tasks' },
    es: { one: '{n} tarea', other: '{n} tareas' },
    de: { one: '{n} Aufgabe', other: '{n} Aufgaben' },
    fr: { one: '{n} tâche', other: '{n} tâches' },
    ru: { one: '{n} задача', few: '{n} задачи', many: '{n} задач', other: '{n} задач' },
  },
  'plan.tasksOf': { it: '{done}/{n} task', en: '{done}/{n} tasks', es: '{done}/{n} tareas', de: '{done}/{n} Aufgaben', fr: '{done}/{n} tâches', ru: '{done}/{n} задач' },
  'plan.hidden': { it: 'nascosto', en: 'hidden', es: 'oculto', de: 'ausgeblendet', fr: 'masqué', ru: 'скрыт' },
  'plan.completed': { it: 'completato', en: 'completed', es: 'completado', de: 'abgeschlossen', fr: 'terminé', ru: 'завершён' },
  'plan.measured': { it: ' misurati', en: ' measured', es: ' medidos', de: ' gemessen', fr: ' mesurés', ru: ' измерено' },
  'plan.sessionTasks': {
    it: 'Task della sessione', en: 'Session tasks', es: 'Tareas de la sesión', de: 'Aufgaben der Sitzung', fr: 'Tâches de la session', ru: 'Задачи сессии',
  },
  'plan.sessionTodos': {
    it: 'To-do della sessione', en: 'Session to-dos', es: 'Pendientes de la sesión', de: 'To-dos der Sitzung', fr: 'To-do de la session', ru: 'Дела сессии',
  },
  'chip.plan': { it: 'PIANO', en: 'PLAN', es: 'PLAN', de: 'PLAN', fr: 'PLAN', ru: 'ПЛАН' },
  'chip.task': { it: 'TASK', en: 'TASK', es: 'TAREA', de: 'TASK', fr: 'TÂCHE', ru: 'ЗАДАЧИ' },
  'chip.todo': { it: 'TO-DO', en: 'TO-DO', es: 'PENDIENTE', de: 'TO-DO', fr: 'TO-DO', ru: 'ДЕЛА' },

  // intestazione e pulsanti
  'head.plans': {
    it: { one: '{n} piano', other: '{n} piani' },
    en: { one: '{n} plan', other: '{n} plans' },
    es: { one: '{n} plan', other: '{n} planes' },
    de: { one: '{n} Plan', other: '{n} Pläne' },
    fr: { one: '{n} plan', other: '{n} plans' },
    ru: { one: '{n} план', few: '{n} плана', many: '{n} планов', other: '{n} планов' },
  },
  'head.working': { it: '{n} al lavoro', en: '{n} working', es: '{n} trabajando', de: '{n} aktiv', fr: '{n} au travail', ru: 'в работе: {n}' },
  'btn.refresh': { it: '↻ aggiorna', en: '↻ refresh', es: '↻ actualizar', de: '↻ aktualisieren', fr: '↻ actualiser', ru: '↻ обновить' },
  'toast.refreshed': {
    it: 'Pannello aggiornato.', en: 'Panel refreshed.', es: 'Panel actualizado.', de: 'Panel aktualisiert.', fr: 'Panneau actualisé.', ru: 'Панель обновлена.',
  },
  'btn.newPlan': { it: '＋ nuovo piano', en: '＋ new plan', es: '＋ nuevo plan', de: '＋ neuer Plan', fr: '＋ nouveau plan', ru: '＋ новый план' },
  'btn.restore': { it: '↺ ripristina', en: '↺ restore', es: '↺ restaurar', de: '↺ wiederherstellen', fr: '↺ restaurer', ru: '↺ вернуть' },
  'btn.hide': { it: '✕ nascondi', en: '✕ hide', es: '✕ ocultar', de: '✕ ausblenden', fr: '✕ masquer', ru: '✕ скрыть' },
  'btn.hideFinished': {
    it: 'nascondi {n} finiti', en: 'hide {n} finished', es: 'ocultar {n} terminados', de: '{n} fertige ausblenden', fr: 'masquer {n} terminés', ru: 'скрыть завершённые ({n})',
  },
  'btn.closeHidden': {
    it: 'chiudi nascosti', en: 'close hidden', es: 'cerrar ocultos', de: 'Ausgeblendete schließen', fr: 'fermer les masqués', ru: 'закрыть скрытые',
  },
  'btn.hiddenCount': { it: '{n} nascosti', en: '{n} hidden', es: '{n} ocultos', de: '{n} ausgeblendet', fr: '{n} masqués', ru: 'скрыто: {n}' },
  'btn.cancel': { it: '✕ annulla', en: '✕ cancel', es: '✕ cancelar', de: '✕ abbrechen', fr: '✕ annuler', ru: '✕ отмена' },
  'empty.none': {
    it: 'Nessun piano recente in questo progetto.',
    en: 'No recent plans in this project.',
    es: 'No hay planes recientes en este proyecto.',
    de: 'Keine aktuellen Pläne in diesem Projekt.',
    fr: 'Aucun plan récent dans ce projet.',
    ru: 'В этом проекте нет недавних планов.',
  },
  'empty.allHidden': {
    it: 'Tutti i piani recenti sono nascosti.',
    en: 'All recent plans are hidden.',
    es: 'Todos los planes recientes están ocultos.',
    de: 'Alle aktuellen Pläne sind ausgeblendet.',
    fr: 'Tous les plans récents sont masqués.',
    ru: 'Все недавние планы скрыты.',
  },

  // riquadro per un nuovo piano
  'composer.title': {
    it: '＋ Nuovo piano di lavoro', en: '＋ New work plan', es: '＋ Nuevo plan de trabajo', de: '＋ Neuer Arbeitsplan', fr: '＋ Nouveau plan de travail', ru: '＋ Новый план работ',
  },
  'composer.enter': {
    it: 'Invio per avviare', en: 'Enter to start', es: 'Intro para iniciar', de: 'Enter zum Starten', fr: 'Entrée pour lancer', ru: 'Enter — запустить',
  },
  'composer.placeholder': {
    it: 'Cosa vuoi ottenere?', en: 'What do you want to achieve?', es: '¿Qué quieres conseguir?', de: 'Was möchtest du erreichen?', fr: 'Que veux-tu obtenir ?', ru: 'Чего вы хотите добиться?',
  },
  'composer.submit': { it: 'avvia', en: 'start', es: 'iniciar', de: 'starten', fr: 'lancer', ru: 'запустить' },
  'composer.noInput': {
    it: 'Qui non c\'è un campo di testo: usa /new-plan {hint}',
    en: 'No text field here: use /new-plan {hint}',
    es: 'Aquí no hay campo de texto: usa /new-plan {hint}',
    de: 'Hier gibt es kein Textfeld: nutze /new-plan {hint}',
    fr: 'Pas de champ de texte ici : utilise /new-plan {hint}',
    ru: 'Здесь нет текстового поля: используйте /new-plan {hint}',
  },
  'composer.internalDesc': {
    it: 'piano in docs/plans con checkbox, eseguito e spuntato passo per passo',
    en: 'plan in docs/plans with checkboxes, run and ticked step by step',
    es: 'plan en docs/plans con casillas, ejecutado y marcado paso a paso',
    de: 'Plan in docs/plans mit Checkboxen, Schritt für Schritt ausgeführt und abgehakt',
    fr: 'plan dans docs/plans avec cases à cocher, exécuté et coché étape par étape',
    ru: 'план в docs/plans с чекбоксами, выполняется и отмечается шаг за шагом',
  },
  'composer.spMissing': {
    it: 'superpowers non trovato: uso il flusso interno',
    en: 'superpowers not found: using the internal flow',
    es: 'superpowers no encontrado: uso el flujo interno',
    de: 'superpowers nicht gefunden: interner Ablauf wird genutzt',
    fr: 'superpowers introuvable : flux interne utilisé',
    ru: 'superpowers не найден: используется встроенный процесс',
  },
  'composer.flow': { it: 'flusso: {m}', en: 'flow: {m}', es: 'flujo: {m}', de: 'Ablauf: {m}', fr: 'flux : {m}', ru: 'процесс: {m}' },
  'flow.auto': { it: 'automatico', en: 'automatic', es: 'automático', de: 'automatisch', fr: 'automatique', ru: 'автоматически' },
  'flow.superpowers': { it: 'superpowers', en: 'superpowers', es: 'superpowers', de: 'superpowers', fr: 'superpowers', ru: 'superpowers' },
  'flow.interno': { it: 'interno', en: 'internal', es: 'interno', de: 'intern', fr: 'interne', ru: 'встроенный' },

  // piano in avvio
  'launch.title': { it: 'Avvio piano', en: 'Starting plan', es: 'Iniciando plan', de: 'Plan startet', fr: 'Lancement du plan', ru: 'Запуск плана' },
  'launch.waitingSp': {
    it: 'in attesa del piano: brainstorming → writing-plans',
    en: 'waiting for the plan: brainstorming → writing-plans',
    es: 'esperando el plan: brainstorming → writing-plans',
    de: 'warte auf den Plan: brainstorming → writing-plans',
    fr: 'en attente du plan : brainstorming → writing-plans',
    ru: 'ожидание плана: brainstorming → writing-plans',
  },
  'launch.waitingFile': {
    it: 'in attesa di {p}', en: 'waiting for {p}', es: 'esperando {p}', de: 'warte auf {p}', fr: 'en attente de {p}', ru: 'ожидание {p}',
  },
  'launch.thePlan': { it: 'il piano', en: 'the plan', es: 'el plan', de: 'den Plan', fr: 'le plan', ru: 'плана' },
  'launch.since': { it: ' · da {t}', en: ' · for {t}', es: ' · desde hace {t}', de: ' · seit {t}', fr: ' · depuis {t}', ru: ' · уже {t}' },
} satisfies Record<string, Entry>

export type MessageKey = keyof typeof M

/** Testo di una chiave nella lingua data; `{nome}` si sostituisce con `vars`, `n` sceglie il plurale. */
export function translate(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const entry: Entry = M[key]
  const raw = entry[lang] ?? entry[FALLBACK]
  const text = typeof raw === 'string' ? raw : (raw[pluralForm(lang, Number(vars.n ?? 0))] ?? raw.other)
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** Una funzione `t` legata a una lingua. */
export const translator = (lang: Lang) => (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars)

/** Chiave della fase per le etichette; una fase sconosciuta resta com'è. */
export const phaseKey = (phase: string): MessageKey | undefined =>
  (`phase.${phase}` in M ? (`phase.${phase}` as MessageKey) : undefined)

/** Tutte le chiavi, per i test. */
export const ALL_KEYS = Object.keys(M) as MessageKey[]
export const entryOf = (key: MessageKey): Entry => M[key]
