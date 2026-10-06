import { seedIssues, seedRuleVersions, seedRules, FIRST_RULE_VERSION_ID, CURRENT_RULE_VERSION_ID } from './seed'
import type {
  Issue,
  Rule,
  RuleVersion,
  RuleChange,
  ReapprovalBatch,
  RereviewTask,
  ReportSnapshot,
  BatchDiff,
} from './types'

// ─── 状态 ─────────────────────────────────────────────────

type EngineState = {
  issues: Issue[]
  rules: Rule[]
  ruleVersions: RuleVersion[]
  currentRuleVersionId: string
  batches: ReapprovalBatch[]
  tasks: RereviewTask[]
  reportSnapshot: ReportSnapshot
}

const state: EngineState = {
  issues: structuredClone(seedIssues),
  rules: structuredClone(seedRules),
  ruleVersions: structuredClone(seedRuleVersions),
  currentRuleVersionId: CURRENT_RULE_VERSION_ID,
  batches: [],
  tasks: [],
  reportSnapshot: {
    publishedAt: '2026-09-01 09:00',
    ruleVersionId: CURRENT_RULE_VERSION_ID,
    conclusions: Object.fromEntries(
      seedIssues.map((issue) => [issue.key, { status: issue.status, passed: issue.status === '已通过' }]),
    ),
  },
}

export const getState = () => state

// ─── 工具 ─────────────────────────────────────────────────

const now = () => '刚刚'

/** 回填缺少规则版本的问题到首版 */
export function backfillRuleVersions(): number {
  const first = state.ruleVersions.find((v) => v.id === FIRST_RULE_VERSION_ID)
  if (!first) return 0
  let count = 0
  state.issues.forEach((issue) => {
    if (!issue.ruleVersionId) {
      issue.ruleVersionId = first.id
      issue.history.push({ at: now(), actor: '系统', action: '规则版本回填', detail: `缺少规则版本，回填首版 ${first.version}。` })
      count++
    }
  })
  return count
}

/** 计算本次发布的差异：受影响的"已通过"问题 */
function computeDiff(changes: RuleChange[]): BatchDiff {
  const changedWcag = new Set(changes.map((c) => c.wcag))
  const passed = state.issues.filter((i) => i.status === '已通过')
  const affected = passed.filter((i) => i.wcag.some((w) => changedWcag.has(w)))

  const allSites = [...new Set(state.issues.map((i) => i.site))]
  const affectedSites = new Set(affected.map((i) => i.site))
  const unaffectedSites = allSites.filter((s) => !affectedSites.has(s))

  return {
    totalPassed: passed.length,
    affectedCount: affected.length,
    unaffectedSites,
    items: affected.map((i) => ({
      issueKey: i.key,
      site: i.site,
      oldStatus: i.status,
      newStatus: '待复测',
      reason: `引用了已变更规则：${i.wcag.filter((w) => changedWcag.has(w)).join('、')}`,
    })),
  }
}

function createBatch(input: {
  ruleVersionId: string
  version: string
  baseVersionId: string
  releasedBy: string
  diff: BatchDiff
  status: ReapprovalBatch['status']
  conflictWith?: string
}): ReapprovalBatch {
  const sites = [...new Set(state.issues.map((i) => i.site))]
  return {
    id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ruleVersionId: input.ruleVersionId,
    ruleVersion: input.version,
    baseVersionId: input.baseVersionId,
    createdAt: now(),
    createdBy: input.releasedBy,
    status: input.status,
    siteCursor: -1,
    sites: sites.map((site) => ({ site, status: 'pending' as const, affectedIssueKeys: [], taskIds: [] })),
    diff: input.diff,
    conflictWith: input.conflictWith,
  }
}

// ─── 规则发布 ─────────────────────────────────────────────

export function releaseRuleVersion(input: {
  version: string
  label: string
  changes: RuleChange[]
  baseVersionId: string
  releasedBy: string
}): { batch: ReapprovalBatch; conflict: boolean; backfilled: number } {
  // 并发比对：baseVersionId 必须等于当前版本，否则后到者保留批次与差异
  if (input.baseVersionId !== state.currentRuleVersionId) {
    const diff = computeDiff(input.changes)
    const winner = state.batches.find((b) => b.status !== 'conflicted')
    const batch = createBatch({
      ruleVersionId: `rv-${input.version}`,
      version: input.version,
      baseVersionId: input.baseVersionId,
      releasedBy: input.releasedBy,
      diff,
      status: 'conflicted',
      conflictWith: winner?.id,
    })
    state.batches.push(batch)
    return { batch, conflict: true, backfilled: 0 }
  }

  // 回填缺失的规则版本
  const backfilled = backfillRuleVersions()

  // 创建新版本
  const newVersion: RuleVersion = {
    id: `rv-${input.version}`,
    version: input.version,
    label: input.label,
    releasedAt: now(),
    releasedBy: input.releasedBy,
    status: 'current',
    changes: input.changes,
  }
  state.ruleVersions = state.ruleVersions.map((v) => (v.status === 'current' ? { ...v, status: 'superseded' as const } : v))
  state.ruleVersions.push(newVersion)
  state.currentRuleVersionId = newVersion.id

  // 计算差异并创建批次
  const diff = computeDiff(input.changes)
  const batch = createBatch({
    ruleVersionId: newVersion.id,
    version: input.version,
    baseVersionId: input.baseVersionId,
    releasedBy: input.releasedBy,
    diff,
    status: 'pending',
  })
  state.batches.push(batch)

  return { batch, conflict: false, backfilled }
}

// ─── 批次推进（按站点游标）────────────────────────────────

export function advanceBatch(batchId: string, simulateFailure = false): ReapprovalBatch {
  const batch = state.batches.find((b) => b.id === batchId)
  if (!batch) throw new Error('批次不存在')

  // 找到下一个待处理或失败的站点
  const nextIndex = batch.sites.findIndex((s) => s.status === 'pending' || s.status === 'failed')
  if (nextIndex === -1) {
    batch.status = 'completed'
    return batch
  }

  const progress = batch.sites[nextIndex]
  progress.status = 'processing'

  if (simulateFailure) {
    progress.status = 'failed'
    progress.error = '模拟重算失败：游标未推进，可从此站点恢复'
    batch.status = 'failed'
    return batch
  }

  // 处理该站点下受影响的问题
  const affectedAtSite = batch.diff.items.filter((item) => item.site === progress.site)
  const taskIds: string[] = []

  for (const item of affectedAtSite) {
    const issue = state.issues.find((i) => i.key === item.issueKey)
    if (!issue) continue

    // 旧结论立即失效：已通过 → 待复测
    if (issue.status === '已通过') {
      issue.status = '待复测'
      issue.history.push({
        at: now(),
        actor: '系统',
        action: '规则升级失效',
        detail: `规则库升级至 ${batch.ruleVersion}，旧"已通过"结论失效，需重新评审。`,
      })
    }

    // 幂等：同一批次同一问题只生成一个任务
    const existing = state.tasks.find((t) => t.batchId === batchId && t.issueKey === item.issueKey)
    if (existing) {
      taskIds.push(existing.id)
    } else {
      const task: RereviewTask = {
        id: `task-${Date.now()}-${item.issueKey}`,
        batchId,
        issueKey: item.issueKey,
        site: item.site,
        oldConclusion: item.oldStatus,
        ruleVersionId: batch.ruleVersionId,
        status: 'pending',
        createdAt: now(),
      }
      state.tasks.push(task)
      taskIds.push(task.id)
    }
  }

  progress.affectedIssueKeys = affectedAtSite.map((i) => i.issueKey)
  progress.taskIds = taskIds
  progress.status = 'completed'
  progress.processedAt = now()

  // 推进游标
  batch.siteCursor = nextIndex

  // 全部站点完成则批次完成
  if (batch.sites.every((s) => s.status === 'completed')) {
    batch.status = 'completed'
  } else {
    batch.status = 'processing'
  }

  return batch
}

// ─── 重审任务确认 ─────────────────────────────────────────

export function confirmTask(
  taskId: string,
  result: '已通过' | '已退回' | '不适用',
  note: string,
  confirmedBy: string,
): RereviewTask {
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task) throw new Error('任务不存在')

  task.status = 'confirmed'
  task.result = result
  task.note = note
  task.confirmedAt = now()
  task.confirmedBy = confirmedBy

  // 同步问题状态
  const issue = state.issues.find((i) => i.key === task.issueKey)
  if (issue) {
    issue.status = result
    issue.retestRecords.push({ id: `RT-${Date.now()}`, actor: confirmedBy, result, note, at: now() })
    issue.history.push({ at: now(), actor: confirmedBy, action: `重审${result}`, detail: note })
  }

  // 该批次全部任务确认后发布新报告快照
  const batchTasks = state.tasks.filter((t) => t.batchId === task.batchId)
  if (batchTasks.length > 0 && batchTasks.every((t) => t.status === 'confirmed')) {
    publishSnapshot()
  }

  return task
}

// ─── 报告快照 ─────────────────────────────────────────────

export function publishSnapshot(): ReportSnapshot {
  const current = state.ruleVersions.find((v) => v.status === 'current')
  state.reportSnapshot = {
    publishedAt: now(),
    ruleVersionId: current?.id ?? '',
    conclusions: Object.fromEntries(
      state.issues.map((i) => [i.key, { status: i.status, passed: i.status === '已通过' }]),
    ),
  }
  return state.reportSnapshot
}

// ─── 查询 ─────────────────────────────────────────────────

export function getBatch(batchId: string): ReapprovalBatch | undefined {
  return state.batches.find((b) => b.id === batchId)
}

export function getTasksByBatch(batchId: string): RereviewTask[] {
  return state.tasks.filter((t) => t.batchId === batchId)
}

export function getTasksByIssue(issueKey: string): RereviewTask[] {
  return state.tasks.filter((t) => t.issueKey === issueKey)
}
