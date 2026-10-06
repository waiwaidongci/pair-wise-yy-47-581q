import { setupWorker } from 'msw/browser'
import { delay, http, HttpResponse } from 'msw'
import { db } from './db'
import { confirmPendingTaskForIssue, confirmTask, publishRules, runBatch } from './ruleStore'
import type { Issue, RuleChange } from './types'

export const worker = setupWorker(
  http.get('/api/issues', ({ request }) => {
    const url = new URL(request.url)
    const query = url.searchParams.get('query')?.toLowerCase() ?? ''
    const status = url.searchParams.get('status') ?? ''
    const site = url.searchParams.get('site') ?? ''
    const filtered = db.issues.filter((issue) => (!query || `${issue.key}${issue.title}${issue.rootCause}`.toLowerCase().includes(query)) && (!status || issue.status === status) && (!site || issue.site === site))
    return HttpResponse.json(filtered)
  }),
  http.post('/api/issues/:key/review', async ({ params, request }) => {
    const issue = db.issues.find((item) => item.key === params.key)
    const body = (await request.json()) as { result: string; note: string; environment: string }
    if (!issue) return new HttpResponse(null, { status: 404 })
    issue.status = body.result as Issue['status']
    issue.retestEnv = body.environment
    issue.retestRecords.push({ id: `RT-${Date.now()}`, actor: '当前用户', result: body.result, note: body.note, at: '刚刚' })
    issue.history.push({ at: '刚刚', actor: '当前用户', action: `复测${body.result}`, detail: body.note })
    // 复测提交即确认该问题挂起的规则重审任务，报告随之切换到新版结论
    confirmPendingTaskForIssue(issue.key, '当前用户')
    return HttpResponse.json(issue)
  }),
  http.post('/api/issues/bulk-assign', async ({ request }) => {
    const body = (await request.json()) as { keys: string[]; team: string; owner: string; dueDate: string; priority: string }
    db.issues = db.issues.map((issue) =>
      body.keys.includes(issue.key)
        ? { ...issue, team: body.team, owner: body.owner, dueDate: body.dueDate, priority: body.priority as Issue['priority'], status: '修复中', history: [...issue.history, { at: '刚刚', actor: '当前用户', action: '批量分配', detail: `指派至 ${body.team} / ${body.owner}` }] }
        : issue,
    )
    return HttpResponse.json({ updated: body.keys.length })
  }),
  http.get('/api/rules', () => HttpResponse.json({ versions: db.ruleVersions, currentRevision: db.currentRevision })),
  http.post('/api/rules/publish', async ({ request }) => {
    const body = (await request.json()) as { id: string; changes: RuleChange[]; baseRevision: number; actor: string }
    const result = await publishRules(body)
    if (!result.ok) return HttpResponse.json(result, { status: 409 })
    return HttpResponse.json(result)
  }),
  http.get('/api/batches', () => HttpResponse.json(db.batches)),
  http.post('/api/batches/:id/run', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { resume?: boolean }
    await delay(300)
    const batch = runBatch(String(params.id), Boolean(body?.resume))
    if (!batch) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json({ batch, issues: db.issues, tasks: db.tasks })
  }),
  http.get('/api/rereview-tasks', () => HttpResponse.json(db.tasks)),
  http.post('/api/rereview-tasks/:id/confirm', async ({ params }) => {
    await delay(150)
    const result = confirmTask(String(params.id))
    if (!result) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json({ ...result, issues: db.issues, tasks: db.tasks })
  }),
)
