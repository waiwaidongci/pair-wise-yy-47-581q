import { seedIssues, seedRuleVersions } from './seed'
import type { Issue, ReReviewBatch, ReReviewTask, RuleVersion } from './types'

/** 模拟服务端的全局状态；规则发布、批次和任务都在这里落库 */
export const db = {
  issues: structuredClone(seedIssues) as Issue[],
  ruleVersions: structuredClone(seedRuleVersions) as RuleVersion[],
  batches: [] as ReReviewBatch[],
  tasks: [] as ReReviewTask[],
  /** 单调递增的规则库修订号，用于发布冲突检测 */
  currentRevision: 1,
  /** 发布生效窗口锁：窗口内的并发提交一律判负 */
  publishInFlight: false,
}
