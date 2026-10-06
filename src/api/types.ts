export type IssueStatus = '待分配' | '修复中' | '待复测' | '已通过' | '已退回' | '不适用'

export type Issue = {
  key: string
  title: string
  site: string
  version: string
  /** 规则库版本 ID；缺失时由首版规则回填 */
  ruleVersionId?: string
  wcag: string[]
  issueType: string
  impact: '致命' | '严重' | '中等' | '轻微'
  affected: string
  reproduction: string
  evidence: string
  rootCause: string
  status: IssueStatus
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  team: string
  owner: string
  dueDate: string
  mergedKeys: string[]
  fixNote?: string
  retestEnv?: string
  retestRecords: Array<{ id: string; actor: string; result: string; note: string; at: string }>
  history: Array<{ at: string; actor: string; action: string; detail: string }>
}

// ─── 规则库 ───────────────────────────────────────────────

export type RuleChangeType = '收紧' | '新增' | '澄清'

export type Rule = {
  id: string
  wcag: string
  /** 首次引入该规则的规则版本 ID */
  introducedVersion: string
  status: 'active' | 'retired'
}

export type RuleChange = {
  wcag: string
  changeType: RuleChangeType
  detail: string
}

export type RuleVersion = {
  id: string
  version: string
  label: string
  releasedAt: string
  releasedBy: string
  status: 'current' | 'superseded'
  changes: RuleChange[]
}

// ─── 重审批次 ─────────────────────────────────────────────

export type BatchStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'conflicted'

export type BatchSiteStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type BatchSiteProgress = {
  site: string
  status: BatchSiteStatus
  /** 该站点下退出"已通过"的问题 */
  affectedIssueKeys: string[]
  /** 已生成的重审任务（幂等依据） */
  taskIds: string[]
  processedAt?: string
  error?: string
}

export type BatchDiffItem = {
  issueKey: string
  site: string
  oldStatus: string
  newStatus: string
  reason: string
}

export type BatchDiff = {
  totalPassed: number
  affectedCount: number
  /** 未受影响、沿用原结论的站点 */
  unaffectedSites: string[]
  items: BatchDiffItem[]
}

export type ReapprovalBatch = {
  id: string
  ruleVersionId: string
  ruleVersion: string
  /** 发布时所依据的规则版本，用于并发比对 */
  baseVersionId: string
  createdAt: string
  createdBy: string
  status: BatchStatus
  /** 站点游标：已处理到的站点下标，-1 表示尚未开始 */
  siteCursor: number
  sites: BatchSiteProgress[]
  diff: BatchDiff
  /** 并发冲突时，胜出的批次 ID */
  conflictWith?: string
}

// ─── 重审任务 ─────────────────────────────────────────────

export type RereviewTaskStatus = 'pending' | 'confirmed'

export type RereviewTask = {
  id: string
  batchId: string
  issueKey: string
  site: string
  oldConclusion: string
  ruleVersionId: string
  status: RereviewTaskStatus
  result?: '已通过' | '已退回' | '不适用'
  note?: string
  createdAt: string
  confirmedAt?: string
  confirmedBy?: string
}

// ─── 整改报告快照 ─────────────────────────────────────────

export type ReportConclusion = {
  status: string
  passed: boolean
}

export type ReportSnapshot = {
  publishedAt: string
  ruleVersionId: string
  /** issueKey -> 发布时结论 */
  conclusions: Record<string, ReportConclusion>
}
