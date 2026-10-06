import { delay } from 'msw'
import { db } from './db'
import type { Issue, ReReviewBatch, ReReviewTask, RuleChange, RuleVersion, SiteProgress } from './types'

/** 旧问题缺失规则版本时回填的首版 */
export const FIRST_RULE_VERSION = 'RV-2026.09'

let batchSeq = 1
let taskSeq = 1

type PublishInput = { id: string; changes: RuleChange[]; baseRevision: number; actor: string }

export type PublishResult =
  | { ok: true; version: RuleVersion; batch: ReReviewBatch; currentRevision: number }
  | { ok: false; keptBatch: ReReviewBatch; currentRevision: number }

/**
 * 发布规则版本并创建重审批次。
 * 并发控制：生效窗口内或基于过期修订的提交判负，但批次与差异保留（状态「冲突保留」）。
 */
export async function publishRules(input: PublishInput): Promise<PublishResult> {
  if (db.publishInFlight || input.baseRevision !== db.currentRevision) {
    const keptBatch: ReReviewBatch = {
      id: `RB-${String(batchSeq++).padStart(3, '0')}`,
      ruleVersionId: input.id,
      revision: input.baseRevision,
      status: '冲突保留',
      createdBy: input.actor,
      createdAt: '刚刚',
      changes: input.changes,
      sites: [],
      cursor: 0,
      attempts: 0,
      error: `提交基于修订 ${input.baseRevision}，但规则库已推进至修订 ${db.currentRevision}；本批次未生效，差异已保留`,
    }
    db.batches.push(keptBatch)
    return { ok: false, keptBatch, currentRevision: db.currentRevision }
  }

  db.publishInFlight = true
  try {
    // 生效窗口：并发提交在此期间到达会被判负
    await delay(400)
    db.currentRevision += 1
    const version: RuleVersion = {
      id: input.id,
      revision: db.currentRevision,
      publishedBy: input.actor,
      publishedAt: '刚刚',
      changes: input.changes,
      status: '已生效',
    }
    db.ruleVersions.push(version)
    const batch: ReReviewBatch = {
      id: `RB-${String(batchSeq++).padStart(3, '0')}`,
      ruleVersionId: version.id,
      revision: version.revision,
      status: '进行中',
      createdBy: input.actor,
      createdAt: '刚刚',
      changes: input.changes,
      sites: [...new Set(db.issues.map((issue) => issue.site))].map((site) => ({
        site,
        status: '待处理' as const,
        affectedKeys: [],
        backfilledKeys: [],
        taskIds: [],
      })),
      cursor: 0,
      attempts: 0,
    }
    db.batches.push(batch)
    return { ok: true, version, batch, currentRevision: db.currentRevision }
  } finally {
    db.publishInFlight = false
  }
}

/**
 * 从站点游标开始执行重算；每个站点处理完才推进游标。
 * 模拟故障：批次首次运行到第二个站点时中断，恢复（resume）后继续。
 */
export function runBatch(batchId: string, resume: boolean): ReReviewBatch | null {
  const batch = db.batches.find((item) => item.id === batchId)
  if (!batch) return null
  if (batch.status === '已完成' || batch.status === '冲突保留') return batch

  batch.status = '进行中'
  batch.attempts += 1
  batch.error = undefined

  while (batch.cursor < batch.sites.length) {
    const progress = batch.sites[batch.cursor]
    if (!resume && batch.attempts === 1 && batch.cursor === 1) {
      progress.status = '失败'
      batch.status = '失败'
      batch.error = `站点「${progress.site}」重算中断：规则校验服务超时。游标停在第 ${batch.cursor + 1}/${batch.sites.length} 站，可从断点恢复，已完成站点不会重复生成任务。`
      return batch
    }
    processSite(batch, progress)
    progress.status = '已完成'
    batch.cursor += 1
  }

  batch.status = '已完成'
  return batch
}

function processSite(batch: ReReviewBatch, progress: SiteProgress) {
  const changedWcag = new Set(batch.changes.map((change) => change.wcag))

  for (const issue of db.issues.filter((item) => item.site === progress.site)) {
    // 旧问题缺少规则版本时回填首版
    if (!issue.ruleVersion) {
      issue.ruleVersion = FIRST_RULE_VERSION
      progress.backfilledKeys.push(issue.key)
      issue.history.push({ at: '刚刚', actor: '系统', action: '规则版本回填', detail: `补齐缺失的规则版本 ${FIRST_RULE_VERSION}` })
    }

    if (!issue.wcag.some((wcag) => changedWcag.has(wcag))) continue

    // 先快照上一版结论，再按新规则重算
    const wasPassed = issue.status === '已通过' && !issue.pendingReReview
    const previousImpact = issue.impact
    const previousRuleVersion = issue.ruleVersion

    for (const change of batch.changes) {
      if (change.field === '影响等级' && change.newImpact && issue.wcag.includes(change.wcag)) {
        issue.impact = change.newImpact
      }
    }

    // 只有受影响的「已通过」问题退出原状态并生成重审任务；按 (批次, 问题) 幂等，恢复时不重复生成
    if (!wasPassed) continue
    if (db.tasks.some((task) => task.batchId === batch.id && task.issueKey === issue.key)) continue

    const task: ReReviewTask = {
      id: `RR-${String(taskSeq++).padStart(3, '0')}`,
      batchId: batch.id,
      issueKey: issue.key,
      site: issue.site,
      ruleVersionId: batch.ruleVersionId,
      status: '待确认',
      previousStatus: '已通过',
      previousImpact,
      previousRuleVersion,
      createdAt: '刚刚',
    }
    db.tasks.push(task)
    progress.taskIds.push(task.id)
    progress.affectedKeys.push(issue.key)
    issue.pendingReReview = {
      taskId: task.id,
      batchId: batch.id,
      previousStatus: '已通过',
      previousImpact,
      previousRuleVersion,
    }
    issue.status = '待复测'
    issue.history.push({
      at: '刚刚',
      actor: '系统',
      action: '规则升级触发重审',
      detail: `规则库 ${batch.ruleVersionId} 发布，旧结论失效，退出「已通过」并生成重审任务 ${task.id}；确认前报告沿用 ${previousRuleVersion} 结论`,
    })
  }
}

/** 确认重审任务：报告从上一版结论快照切换到当前结论 */
export function confirmTask(taskId: string, actor = '当前用户'): { task: ReReviewTask; issue?: Issue } | null {
  const task = db.tasks.find((item) => item.id === taskId)
  if (!task || task.status === '已确认') return null
  task.status = '已确认'
  task.confirmedAt = '刚刚'
  const issue = db.issues.find((item) => item.key === task.issueKey)
  if (issue?.pendingReReview?.taskId === task.id) {
    delete issue.pendingReReview
    issue.history.push({ at: '刚刚', actor, action: '重审确认', detail: `重审任务 ${task.id} 已确认，报告切换至 ${task.ruleVersionId} 口径结论` })
  }
  return { task, issue }
}

/** 复测提交时联动确认该问题挂起的重审任务 */
export function confirmPendingTaskForIssue(issueKey: string, actor: string) {
  const issue = db.issues.find((item) => item.key === issueKey)
  if (issue?.pendingReReview) confirmTask(issue.pendingReReview.taskId, actor)
}
