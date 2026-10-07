import { markdownToAdf } from '@jira-mgr/core/adf'
import { readSettings, readTimer, writeSettings, writeTimer } from '@jira-mgr/core/state'
import { loadFixture, usePsapacState, type Recorded } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import type { Deps } from '../../context.js'
import { COMMANDS } from '../../schema.js'
import { calls, serveExtras } from '../../test-extras.js'
import { http, runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'
import { issueType, serveWrites, withIssueFields } from '../../test-write.js'

const spec = (id: string) => COMMANDS.find((c) => c.path.join(' ') === id)

usePsapacState()

// The new issue is the recorded Story PSAPAC-3066; the running timers sit on PSAPAC-12.
const NEW = 'PSAPAC-3066'
const OLD = 'PSAPAC-12'
const worklogs = (key: string) => `/rest/api/3/issue/${key}/worklog?adjustEstimate=auto`

/** Local times, so the midnight rule reads the same in any zone the tests run in. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)
const NOW = at(7, 9, 30)
const deps: Deps = { http, now: () => NOW }
/** Status, pause and resume never reach for the client, so a Keychain read would throw. */
const offline: Deps = { now: () => NOW }

const seg = (start: Date, end: Date | null = null) => ({
  start: start.toISOString(),
  end: end?.toISOString() ?? null,
})
const timerOn = (issueKey: string, ...segments: ReturnType<typeof seg>[]) =>
  writeTimer({ issueKey, segments })

/** 1h 30m running since 08:00, the same day. */
const normal = () => timerOn(OLD, seg(at(7, 8)))
/** 9h 30m, past the 8 hour threshold. */
const overThreshold = () => timerOn(OLD, seg(at(7, 0, 1)))
/** 1h 30m, but started the day before. */
const acrossMidnight = () => timerOn(OLD, seg(at(6, 23, 30), at(6, 23, 45)), seg(at(7, 9)))

const worklogAnswer = ({ method, path }: Recorded) =>
  method === 'POST' && path.includes('/worklog')
    ? Response.json((loadFixture('worklogs-psapac-666') as { worklogs: unknown[] }).worklogs[0])
    : undefined

/** The Jira side: the recorded issue and a worklog POST that succeeds, unless `respond` says otherwise. */
const serve = (respond?: (request: Recorded) => Response | undefined) =>
  serveWrites({ respond: (request) => respond?.(request) ?? worklogAnswer(request) }).requests

const posts = (requests: Recorded[]) => requests.filter((r) => r.path.includes('/worklog'))
const failWorklog = ({ method, path }: Recorded) =>
  method === 'POST' && path.includes('/worklog')
    ? Response.json({ errorMessages: ['Boom'], errors: {} }, { status: 500 })
    : undefined

/** Ctrl-C lands as the worklog request arrives, and Jira never answers it. */
const interruptWorklog =
  (controller: AbortController) =>
  ({ method, path }: Recorded) => {
    if (method !== 'POST' || !path.includes('/worklog')) return undefined
    controller.abort()
    return new Response(new ReadableStream())
  }

describe('jm timer start', () => {
  it('starts a timer on an idle machine after reading the issue', async () => {
    const requests = serve()
    const { code, data, f } = await runJson(['timer', 'start', NEW], deps)
    expect(code).toBe(0)
    expectShape(data, spec('timer start')?.output.example)
    expect(data).toMatchObject({
      timer: { issueKey: NEW, state: 'running', elapsedSeconds: 0 },
      stopped: null,
      logged: null,
    })
    expect(requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`)).toEqual([
      `GET /rest/api/3/issue/${NEW}`,
    ])
    expect(await readTimer()).toEqual({ issueKey: NEW, segments: [seg(NOW)] })
    expect(f.stderr).toBe('')
  })

  it('does nothing when the issue is already running', async () => {
    await timerOn(NEW, seg(at(7, 8)))
    const requests = serve()
    const { code, data } = await runJson(['timer', 'start', NEW], deps)
    expect(code).toBe(0)
    expect(data).toMatchObject({ timer: { state: 'running', elapsedSeconds: 5400 }, stopped: null })
    expect(posts(requests)).toEqual([])
    expect(await readTimer()).toEqual({ issueKey: NEW, segments: [seg(at(7, 8))] })
  })

  it('resumes a paused timer on the same issue', async () => {
    await timerOn(NEW, seg(at(7, 8), at(7, 9)))
    const requests = serve()
    const { code, data } = await runJson(['timer', 'start', NEW], deps)
    expect(code).toBe(0)
    expect(data).toMatchObject({ timer: { state: 'running', elapsedSeconds: 3600 } })
    expect(posts(requests)).toEqual([])
    expect(await readTimer()).toEqual({
      issueKey: NEW,
      segments: [seg(at(7, 8), at(7, 9)), seg(NOW)],
    })
  })

  it('logs the running timer, rounded, before it switches', async () => {
    await timerOn(OLD, seg(at(7, 8), at(7, 8, 20)), seg(at(7, 9)))
    const requests = serve()
    const { code, data } = await runJson(['timer', 'start', NEW], deps)
    expect(code).toBe(0)
    expect(data).toMatchObject({
      timer: { issueKey: NEW, state: 'running' },
      stopped: { issueKey: OLD, timeSpent: '50m', needsConfirmation: false },
      logged: { id: '120440' },
    })
    expect(requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`)).toEqual([
      `GET /rest/api/3/issue/${NEW}`,
      `POST /rest/api/3/issue/${OLD}/worklog`,
    ])
    expect(posts(requests)[0]?.path).toBe(worklogs(OLD))
    expect(posts(requests)[0]?.body).toEqual({
      timeSpent: '50m',
      started: at(7, 8).toISOString().replace('Z', '+0000'),
    })
    expect(await readTimer()).toEqual({ issueKey: NEW, segments: [seg(NOW)] })
  })

  it.each([
    ['past the threshold', overThreshold],
    ['across midnight', acrossMidnight],
  ])('refuses a switch whose draft is %s unless --confirm', async (_name, setUp) => {
    await setUp()
    const before = await readTimer()
    const requests = serve()
    const { code, error } = await runJson(['timer', 'start', NEW], deps)
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toMatch(/ since \d{4}-\d{2}-\d{2} \d{2}:\d{2}, /)
    expect(error?.message).toContain('--confirm')
    expect(error?.message).toContain(`jm timer stop --time <duration> --expect ${OLD}`)
    expect(error?.message).toContain('jm timer stop --discard')
    expect(error?.details).toMatchObject({ draft: { issueKey: OLD, needsConfirmation: true } })
    expect(posts(requests)).toEqual([])
    expect(await readTimer()).toEqual(before)

    const confirmed = await runJson(['timer', 'start', NEW, '--confirm'], deps)
    expect(confirmed.code).toBe(0)
    expect(posts(requests)).toHaveLength(1)
    expect(await readTimer()).toEqual({ issueKey: NEW, segments: [seg(NOW)] })
  })

  it('does not ask for confirmation when the long timer is the one being started', async () => {
    await timerOn(NEW, seg(at(7, 0, 1)))
    const requests = serve()
    expect((await runJson(['timer', 'start', NEW], deps)).code).toBe(0)
    expect(posts(requests)).toEqual([])
  })

  it('refuses when --expect names another issue, logging nothing', async () => {
    await normal()
    const requests = serve()
    const { code, error } = await runJson(['timer', 'start', NEW, '--expect', 'PSAPAC-99'], deps)
    expect(code).toBe(2)
    expect(error?.details).toMatchObject({
      runningIssueKey: OLD,
      expectedIssueKey: 'PSAPAC-99',
    })
    expect(posts(requests)).toEqual([])
    expect((await readTimer())?.issueKey).toBe(OLD)
  })

  it('reports a --expect mismatch, not the confirmation, for a long timer', async () => {
    await overThreshold()
    serve()
    const { code, error } = await runJson(['timer', 'start', NEW, '--expect', 'PSAPAC-99'], deps)
    expect(code).toBe(2)
    expect(error?.details).toMatchObject({ runningIssueKey: OLD, expectedIssueKey: 'PSAPAC-99' })
  })

  it('refuses an Epic before it asks about a long timer', async () => {
    await overThreshold()
    serve(withIssueFields({ issuetype: issueType('Epic') }))
    const { code, error } = await runJson(['timer', 'start', NEW], deps)
    expect(code).toBe(2)
    expect(error?.message).toContain('Only Task, Bug, Story and Subtask can be timed')
  })

  it('switches when --expect names the running issue', async () => {
    await normal()
    serve()
    const { code } = await runJson(['timer', 'start', NEW, '--expect', OLD.toLowerCase()], deps)
    expect(code).toBe(0)
    expect((await readTimer())?.issueKey).toBe(NEW)
  })

  it('refuses an Epic after reading it, and starts nothing', async () => {
    await normal()
    const requests = serve(withIssueFields({ issuetype: issueType('Epic') }))
    const { code, error } = await runJson(['timer', 'start', NEW], deps)
    expect(code).toBe(2)
    expect(error?.message).toContain('Only Task, Bug, Story and Subtask can be timed')
    expect(calls(requests)).toHaveLength(1)
    expect(posts(requests)).toEqual([])
    expect((await readTimer())?.issueKey).toBe(OLD)
  })

  it('refuses a key outside the project before any request', async () => {
    const requests = serve()
    const { code, error } = await runJson(['timer', 'start', 'OTHER-1'], deps)
    expect(code).toBe(2)
    expect(error?.message).toContain('not in PSAPAC')
    expect(requests).toEqual([])
    expect(await readTimer()).toBeNull()
  })

  it('exits 3 for an issue that does not exist', async () => {
    serve(({ method, path }) =>
      method === 'GET' && path.includes('/issue/')
        ? Response.json({ errorMessages: ['Issue does not exist'], errors: {} }, { status: 404 })
        : undefined,
    )
    expect((await runJson(['timer', 'start', NEW], deps)).code).toBe(3)
    expect(await readTimer()).toBeNull()
  })

  it('keeps the old timer, paused, when its worklog fails, and does not start the new one', async () => {
    await timerOn(OLD, seg(at(7, 8)))
    serve(failWorklog)
    const { code, error } = await runJson(['timer', 'start', NEW], deps)
    expect(code).toBe(5)
    expect(error?.message).toContain(`started ${at(7, 8).toISOString()}`)
    expect(error?.message).toContain(`The timer is paused on ${OLD}`)
    expect(await readTimer()).toEqual({ issueKey: OLD, segments: [seg(at(7, 8), NOW)] })
  })

  it('exits 130 with the old timer paused when Ctrl-C lands during its worklog', async () => {
    await timerOn(OLD, seg(at(7, 8)))
    const controller = new AbortController()
    const requests = serve(interruptWorklog(controller))
    const { code, f } = await runJson(['timer', 'start', NEW], deps, { signal: controller.signal })
    expect(code).toBe(130)
    expect(f.stdout).toBe('')
    expect(f.stderr).toContain(
      `jm: Logging 1h 30m on ${OLD} (started ${at(7, 8).toISOString()}) failed`,
    )
    expect(f.stderr).toContain(`The timer is paused on ${OLD}; stop the timer again.`)
    expect(posts(requests)).toHaveLength(1)
    expect(await readTimer()).toEqual({ issueKey: OLD, segments: [seg(at(7, 8), NOW)] })
  })

  it('prints the switch and the new timer on a terminal', async () => {
    await normal()
    serve()
    const { code, lines } = await runTty(['timer', 'start', NEW], {}, deps)
    expect(code).toBe(0)
    expect(lines[0]).toBe(`Logged 1h 30m on ${OLD} (worklog 120440)`)
    expect(lines[1]).toMatch(/^Issue: +PSAPAC-3066$/)
    expect(lines[2]).toMatch(/^State: +running$/)
  })
})

describe('jm timer stop', () => {
  it('logs the rounded draft from the first segment, skipping the pause', async () => {
    await timerOn(
      OLD,
      seg(at(7, 7, 30), at(7, 8, 30)),
      seg(at(7, 9), at(7, 9, 20)),
      seg(at(7, 9, 25)),
    )
    const requests = serveExtras(worklogAnswer)
    const { code, data, f } = await runJson(['timer', 'stop'], deps)
    expect(code).toBe(0)
    expectShape(data, spec('timer stop')?.output.example)
    // 60m + 20m + 5m = 85m, which rounds to 85m on the 5m step.
    expect(data).toMatchObject({
      draft: {
        issueKey: OLD,
        timeSpent: '1h 25m',
        seconds: 5100,
        started: at(7, 7, 30).toISOString(),
      },
      worklog: { id: '120440' },
    })
    expect(calls(requests)).toEqual([`POST ${worklogs(OLD)}`])
    expect(requests[0]?.body).toEqual({
      timeSpent: '1h 25m',
      started: at(7, 7, 30).toISOString().replace('Z', '+0000'),
    })
    expect(await readTimer()).toBeNull()
    expect(f.stderr).toBe('')
  })

  it('rounds by the step in settings', async () => {
    await writeSettings({
      ...(await readSettings()),
      timer: { rounding: '15m', reminderThresholdHours: 8, reminderIntervalMinutes: 60 },
    })
    await timerOn(OLD, seg(at(7, 8, 55)))
    const requests = serveExtras(worklogAnswer)
    expect((await runJson(['timer', 'stop'], deps)).code).toBe(0)
    // 35 minutes rounds to 30 on the 15m step.
    expect(requests[0]?.body).toMatchObject({ timeSpent: '30m' })
  })

  it('sends --comment as ADF', async () => {
    await normal()
    const requests = serveExtras(worklogAnswer)
    const { code } = await runJson(['timer', 'stop', '--comment', 'Pair *work*'], deps)
    expect(code).toBe(0)
    expect(requests[0]?.body).toMatchObject({ comment: markdownToAdf('Pair *work*') })
  })

  it('prints the worklog on a terminal', async () => {
    await normal()
    serveExtras(worklogAnswer)
    const { code, f } = await runTty(['timer', 'stop'], {}, deps)
    expect(code).toBe(0)
    expect(f.stdout).toMatch(new RegExp(`^Logged .+ on ${OLD} \\(worklog 120440\\)\\n$`))
  })

  it.each([
    ['past the threshold', overThreshold],
    ['across midnight', acrossMidnight],
  ])('exits 2 with the draft when it runs %s, until --confirm', async (_name, setUp) => {
    await setUp()
    const before = await readTimer()
    const requests = serveExtras(worklogAnswer)
    const { code, error } = await runJson(['timer', 'stop'], deps)
    expect(code).toBe(2)
    expect(error?.message).toMatch(/ since \d{4}-\d{2}-\d{2} \d{2}:\d{2}, /)
    expect(error?.message).toContain('--confirm')
    expect(error?.message).toContain(`--expect ${OLD}`)
    expect(error?.details).toMatchObject({
      draft: { issueKey: OLD, needsConfirmation: true, started: expect.any(String) as string },
    })
    expect(requests).toEqual([])
    expect(await readTimer()).toEqual(before)

    expect((await runJson(['timer', 'stop', '--confirm'], deps)).code).toBe(0)
    expect(posts(requests)).toHaveLength(1)
    expect(await readTimer()).toBeNull()
  })

  it('exits 130 with the timer back, paused, when Ctrl-C lands during the worklog', async () => {
    await timerOn(OLD, seg(at(7, 8)))
    const controller = new AbortController()
    const requests = serveExtras(interruptWorklog(controller))
    const { code, f } = await runJson(['timer', 'stop'], deps, { signal: controller.signal })
    expect(code).toBe(130)
    expect(f.stdout).toBe('')
    expect(f.stderr).toContain(
      `jm: Logging 1h 30m on ${OLD} (started ${at(7, 8).toISOString()}) failed`,
    )
    expect(f.stderr).toContain(`The timer is paused on ${OLD}; stop the timer again.`)
    expect(posts(requests)).toHaveLength(1)
    expect(await readTimer()).toEqual({ issueKey: OLD, segments: [seg(at(7, 8), NOW)] })
  })

  it('prints the draft refusal on stderr on a terminal', async () => {
    await overThreshold()
    serveExtras(worklogAnswer)
    const { code, f } = await runTty(['timer', 'stop'], { stderrIsTTY: true }, deps)
    expect(code).toBe(2)
    expect(f.stdout).toBe('')
    expect(f.stderr).toMatch(/^jm: PSAPAC-12 has run 9h 30m since /)
  })

  it('takes --time with --expect in place of --confirm, and logs that time', async () => {
    await overThreshold()
    const requests = serveExtras(worklogAnswer)
    const { code } = await runJson(['timer', 'stop', '--time', '7h30m', '--expect', OLD], deps)
    expect(code).toBe(0)
    expect(requests[0]?.body).toMatchObject({ timeSpent: '7h 30m' })
    expect(await readTimer()).toBeNull()
  })

  it('refuses --time without --expect, before any request or stop', async () => {
    await normal()
    const requests = serveExtras(worklogAnswer)
    const { code, error } = await runJson(['timer', 'stop', '--time', '1h'], deps)
    expect(code).toBe(2)
    expect(error?.message).toContain('expectRunning')
    expect(requests).toEqual([])
    expect((await readTimer())?.issueKey).toBe(OLD)
  })

  it('refuses --time without --expect on a long draft too', async () => {
    await overThreshold()
    const requests = serveExtras(worklogAnswer)
    expect((await runJson(['timer', 'stop', '--time', '1h'], deps)).code).toBe(2)
    expect(requests).toEqual([])
    expect((await readTimer())?.issueKey).toBe(OLD)
  })

  it('refuses when --expect names another issue, logging and stopping nothing', async () => {
    await normal()
    const requests = serveExtras(worklogAnswer)
    const { code, error } = await runJson(['timer', 'stop', '--expect', 'PSAPAC-99'], deps)
    expect(code).toBe(2)
    expect(error?.details).toMatchObject({ runningIssueKey: OLD, expectedIssueKey: 'PSAPAC-99' })
    expect(requests).toEqual([])
    expect((await readTimer())?.issueKey).toBe(OLD)
  })

  it('reports a --expect mismatch, not the confirmation, for a long timer', async () => {
    await overThreshold()
    const { code, error } = await runJson(['timer', 'stop', '--expect', 'PSAPAC-99'], deps)
    expect(code).toBe(2)
    expect(error?.details).toMatchObject({ runningIssueKey: OLD, expectedIssueKey: 'PSAPAC-99' })
  })

  it('puts the timer back paused when the worklog fails, and says when it started', async () => {
    await timerOn(OLD, seg(at(7, 8)))
    serveExtras(failWorklog)
    const { code, error } = await runJson(['timer', 'stop'], deps)
    expect(code).toBe(5)
    expect(error?.message).toContain(`started ${at(7, 8).toISOString()}`)
    expect(error?.message).toContain(`The timer is paused on ${OLD}; stop the timer again.`)
    expect(error?.details).toMatchObject({ restored: true, draft: { issueKey: OLD } })
    expect(await readTimer()).toEqual({ issueKey: OLD, segments: [seg(at(7, 8), NOW)] })
  })

  it("keeps core's own message when the worklog is refused with a 400", async () => {
    await timerOn(OLD, seg(at(7, 8)))
    serveExtras(({ method, path }) =>
      method === 'POST' && path.includes('/worklog')
        ? Response.json({ errorMessages: ['Bad time'], errors: {} }, { status: 400 })
        : undefined,
    )
    const { code, error } = await runJson(['timer', 'stop'], deps)
    expect(code).toBe(2)
    expect(error?.message).toContain(`The timer is paused on ${OLD}; stop the timer again.`)
    expect(error?.message).not.toContain('Pass --confirm')
    expect(error?.details).toMatchObject({ restored: true })
    expect(await readTimer()).toEqual({ issueKey: OLD, segments: [seg(at(7, 8), NOW)] })
  })

  it('exits 0 with null when no timer runs, and sends nothing', async () => {
    const requests = serveExtras(worklogAnswer)
    const { code, body } = await runJson(['timer', 'stop'], deps)
    expect(code).toBe(0)
    expect(body).toEqual({ data: null })
    expect(requests).toEqual([])
    const tty = await runTty(['timer', 'stop'], {}, deps)
    expect(tty.code).toBe(0)
    expect(tty.f.stdout).toBe('')
  })

  describe('--discard', () => {
    it('drops the timer and logs nothing', async () => {
      await overThreshold()
      const requests = serveExtras(worklogAnswer)
      const { code, data } = await runJson(['timer', 'stop', '--discard'], deps)
      expect(code).toBe(0)
      expectShape(data, spec('timer stop')?.output.example)
      expect(data).toMatchObject({ draft: { issueKey: OLD, timeSpent: '9h 30m' }, worklog: null })
      expect(requests).toEqual([])
      expect(await readTimer()).toBeNull()
    })

    it('prints what it dropped on a terminal', async () => {
      await normal()
      const { f } = await runTty(['timer', 'stop', '--discard'], {}, offline)
      expect(f.stdout).toBe(`Discarded the timer on ${OLD} (1h 30m not logged)\n`)
    })

    it('exits 0 with null when no timer runs', async () => {
      const { code, body } = await runJson(['timer', 'stop', '--discard'], offline)
      expect(code).toBe(0)
      expect(body).toEqual({ data: null })
    })

    it('keeps a timer that --expect does not name', async () => {
      await normal()
      const { code } = await runJson(['timer', 'stop', '--discard', '--expect', NEW], offline)
      expect(code).toBe(2)
      expect((await readTimer())?.issueKey).toBe(OLD)
    })

    it.each([['--comment', 'x'], ['--time', '1h'], ['--confirm']])(
      'conflicts with %s',
      async (...flag) => {
        await normal()
        const { code } = await runJson(['timer', 'stop', '--discard', ...flag], offline)
        expect(code).toBe(2)
        expect((await readTimer())?.issueKey).toBe(OLD)
      },
    )
  })
})

describe('jm timer status', () => {
  it('shows a running timer, reading no credentials', async () => {
    await normal()
    const { code, data, f } = await runJson(['timer', 'status'], offline)
    expect(code).toBe(0)
    expectShape(data, spec('timer status')?.output.example)
    expect(data).toEqual({
      issueKey: OLD,
      state: 'running',
      elapsedSeconds: 5400,
      draft: {
        issueKey: OLD,
        started: at(7, 8).toISOString(),
        seconds: 5400,
        timeSpent: '1h 30m',
        needsConfirmation: false,
      },
    })
    expect(f.stderr).toBe('')
  })

  it('shows a paused timer with the paused time left out', async () => {
    await timerOn(OLD, seg(at(7, 8), at(7, 8, 20)), seg(at(7, 9), at(7, 9, 5)))
    const { data } = await runJson(['timer', 'status'], offline)
    expect(data).toMatchObject({
      state: 'paused',
      elapsedSeconds: 1500,
      draft: { timeSpent: '25m' },
    })
  })

  it('flags a draft that needs confirmation', async () => {
    await acrossMidnight()
    const { data } = await runJson(['timer', 'status'], offline)
    expect(data).toMatchObject({ draft: { needsConfirmation: true } })
  })

  it('rounds by the step in settings', async () => {
    await writeSettings({
      ...(await readSettings()),
      timer: { rounding: 'none', reminderThresholdHours: 8, reminderIntervalMinutes: 60 },
    })
    await timerOn(OLD, seg(at(7, 9, 7)))
    const { data } = await runJson(['timer', 'status'], offline)
    expect(data).toMatchObject({ draft: { timeSpent: '23m' } })
  })

  it('is null with no timer, saying so on stderr on a terminal only', async () => {
    const piped = await runJson(['timer', 'status'], offline)
    expect(piped.body).toEqual({ data: null })
    expect(piped.f.stderr).toBe('')
    const tty = await runTty(['timer', 'status'], {}, offline)
    expect(tty.code).toBe(0)
    expect(tty.f.stdout).toBe('')
    expect(tty.f.stderr).toBe('No timer is running.\n')
  })

  it('prints a record on a terminal', async () => {
    await acrossMidnight()
    const { code, lines } = await runTty(['timer', 'status'], {}, offline)
    expect(code).toBe(0)
    expect(lines.slice(0, 5)).toEqual([
      `Issue:              ${OLD}`,
      'State:              running',
      'Started:            2026-10-06 23:30',
      'Elapsed:            45m',
      'Would log:          45m',
    ])
    expect(lines[5]).toBe('Needs confirmation: yes')
  })
})

describe('jm timer pause and resume', () => {
  it('pauses a running timer, and a second pause changes nothing', async () => {
    await normal()
    const first = await runJson(['timer', 'pause'], offline)
    expect(first.code).toBe(0)
    expectShape(first.data, spec('timer pause')?.output.example)
    expect(first.data).toMatchObject({ state: 'paused', elapsedSeconds: 5400 })
    const paused = await readTimer()
    expect(paused).toEqual({ issueKey: OLD, segments: [seg(at(7, 8), NOW)] })

    const second = await runJson(['timer', 'pause'], { now: () => at(7, 11) })
    expect(second.code).toBe(0)
    expect(second.data).toMatchObject({ state: 'paused', elapsedSeconds: 5400 })
    expect(await readTimer()).toEqual(paused)
  })

  it('resumes a paused timer, and a second resume changes nothing', async () => {
    await timerOn(OLD, seg(at(7, 8), at(7, 9)))
    const first = await runJson(['timer', 'resume'], offline)
    expect(first.code).toBe(0)
    expectShape(first.data, spec('timer resume')?.output.example)
    expect(first.data).toMatchObject({ state: 'running', elapsedSeconds: 3600 })
    const running = await readTimer()
    expect(running).toEqual({ issueKey: OLD, segments: [seg(at(7, 8), at(7, 9)), seg(NOW)] })

    const second = await runJson(['timer', 'resume'], { now: () => at(7, 11) })
    expect(second.code).toBe(0)
    expect(await readTimer()).toEqual(running)
  })

  it.each(['pause', 'resume'])('%s exits 3 with no timer', async (verb) => {
    const { code, error } = await runJson(['timer', verb], offline)
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
    expect(await readTimer()).toBeNull()
  })

  it('prints the record on a terminal', async () => {
    await normal()
    const { code, lines } = await runTty(['timer', 'pause'], {}, offline)
    expect(code).toBe(0)
    expect(lines[1]).toBe('State:     paused')
  })
})
