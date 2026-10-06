import { setupWorker } from 'msw/browser'
import { http, HttpResponse } from 'msw'
import type { Issue } from './types'
import {
  getState,
  releaseRuleVersion,
  advanceBatch,
  confirmTask,
  publishSnapshot,
  backfillRuleVersions,
  getTasksByBatch,
} from './reapprovalEngine'

export const worker = setupWorker(
  // ─── 问题台账 ───────────────────────────────────────────
  http.get('/api/issues', ({ request }) => {
    const issues = getState().issues
    const url = new URL(request.url)
    const query = url.searchParams.get('query')?.toLowerCase() ?? ''
    const status = url.searchParams.get('status') ?? ''
    const site = url.searchParams.get('site') ?? ''
    const filtered = issues.filter((issue) => (!query || `${issue.key}${issue.title}${issue.rootCause}`.toLowerCase().includes(query)) && (!status || issue.status === status) && (!site || issue.site === site))
    return HttpResponse.json(filtered)
  }),
  http.post('/api/issues/:key/review', async ({ params, request }) => {
    const issues = getState().issues
    const issue = issues.find((item) => item.key === params.key)
    const body = (await request.json()) as { result: string; note: string; environment: string }
    if (!issue) return new HttpResponse(null, { status: 404 })
    issue.status = body.result as Issue['status']
    issue.retestEnv = body.environment
    issue.retestRecords.push({ id: `RT-${Date.now()}`, actor: '当前用户', result: body.result, note: body.note, at: '刚刚' })
    issue.history.push({ at: '刚刚', actor: '当前用户', action: `复测${body.result}`, detail: body.note })
    return HttpResponse.json(issue)
  }),
  http.post('/api/issues/bulk-assign', async ({ request }) => {
    const issues = getState().issues
    const body = (await request.json()) as { keys: string[]; team: string; owner: string; dueDate: string; priority: string }
    const updated: Issue[] = issues.map((issue) =>
      body.keys.includes(issue.key)
        ? { ...issue, team: body.team, owner: body.owner, dueDate: body.dueDate, priority: body.priority as Issue['priority'], status: '修复中' as Issue['status'], history: [...issue.history, { at: '刚刚', actor: '当前用户', action: '批量分配', detail: `指派至 ${body.team} / ${body.owner}` }] }
        : issue,
    )
    // 写回引擎状态
    getState().issues = updated
    return HttpResponse.json({ updated: body.keys.length })
  }),

  // ─── 规则库 ─────────────────────────────────────────────
  http.get('/api/rules', () => {
    const state = getState()
    return HttpResponse.json({ rules: state.rules, ruleVersions: state.ruleVersions, currentRuleVersionId: state.currentRuleVersionId })
  }),

  http.post('/api/rules/release', async ({ request }) => {
    const body = (await request.json()) as {
      version: string
      label: string
      changes: Array<{ wcag: string; changeType: '收紧' | '新增' | '澄清'; detail: string }>
      baseVersionId: string
      releasedBy: string
    }
    const result = releaseRuleVersion(body)
    if (result.conflict) {
      return HttpResponse.json({ conflict: true, batch: result.batch }, { status: 409 })
    }
    return HttpResponse.json({ conflict: false, batch: result.batch, backfilled: result.backfilled })
  }),

  http.post('/api/rules/backfill', () => {
    const count = backfillRuleVersions()
    return HttpResponse.json({ backfilled: count })
  }),

  // ─── 重审批次 ───────────────────────────────────────────
  http.get('/api/reapproval-batches', () => {
    const state = getState()
    return HttpResponse.json(state.batches)
  }),

  http.get('/api/reapproval-batches/:id', ({ params }) => {
    const state = getState()
    const batch = state.batches.find((b) => b.id === params.id)
    if (!batch) return new HttpResponse(null, { status: 404 })
    const tasks = getTasksByBatch(batch.id)
    return HttpResponse.json({ batch, tasks })
  }),

  http.post('/api/reapproval-batches/:id/advance', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { simulateFailure?: boolean }
    try {
      const batch = advanceBatch(params.id as string, body.simulateFailure ?? false)
      return HttpResponse.json(batch)
    } catch {
      return new HttpResponse(null, { status: 404 })
    }
  }),

  // ─── 重审任务 ───────────────────────────────────────────
  http.post('/api/rereview-tasks/:id/confirm', async ({ params, request }) => {
    const body = (await request.json()) as { result: '已通过' | '已退回' | '不适用'; note: string; confirmedBy: string }
    try {
      const task = confirmTask(params.id as string, body.result, body.note, body.confirmedBy)
      return HttpResponse.json(task)
    } catch {
      return new HttpResponse(null, { status: 404 })
    }
  }),

  // ─── 整改报告快照 ───────────────────────────────────────
  http.get('/api/report-snapshot', () => {
    const state = getState()
    return HttpResponse.json(state.reportSnapshot)
  }),

  http.post('/api/report-snapshot/publish', () => {
    const snapshot = publishSnapshot()
    return HttpResponse.json(snapshot)
  }),
)
