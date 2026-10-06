export type IssueStatus = '待分配' | '修复中' | '待复测' | '已通过' | '已退回' | '不适用'

export type PendingReReview = {
  taskId: string
  batchId: string
  previousStatus: IssueStatus
  previousImpact: Issue['impact']
  previousRuleVersion: string
}

export type Issue = {
  key: string
  title: string
  site: string
  version: string
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
  /** 结论所依据的规则库版本；旧数据可能缺失，重算时回填首版 */
  ruleVersion?: string
  /** 规则升级后被置为待重审时，快照上一版结论；重审确认前报告沿用该快照 */
  pendingReReview?: PendingReReview
  retestRecords: Array<{ id: string; actor: string; result: string; note: string; at: string }>
  history: Array<{ at: string; actor: string; action: string; detail: string }>
}

export type RuleChange = {
  wcag: string
  field: '判定标准' | '影响等级' | '适用范围'
  before: string
  after: string
  /** field 为「影响等级」时，受影响问题重算到该等级 */
  newImpact?: Issue['impact']
}

export type RuleVersion = {
  id: string
  revision: number
  publishedBy: string
  publishedAt: string
  changes: RuleChange[]
  status: '已生效'
}

export type SiteProgress = {
  site: string
  status: '待处理' | '已完成' | '失败'
  affectedKeys: string[]
  backfilledKeys: string[]
  taskIds: string[]
}

export type ReReviewBatch = {
  id: string
  ruleVersionId: string
  revision: number
  status: '进行中' | '已完成' | '失败' | '冲突保留'
  createdBy: string
  createdAt: string
  /** 发布时的规则差异快照；冲突保留的批次也依赖它留存 */
  changes: RuleChange[]
  sites: SiteProgress[]
  /** 下一个待处理站点的下标；失败后从这里恢复 */
  cursor: number
  attempts: number
  error?: string
}

export type ReReviewTask = {
  id: string
  batchId: string
  issueKey: string
  site: string
  ruleVersionId: string
  status: '待确认' | '已确认'
  previousStatus: IssueStatus
  previousImpact: Issue['impact']
  previousRuleVersion: string
  createdAt: string
  confirmedAt?: string
}
