import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Issue, Rule, RuleVersion, ReapprovalBatch, ReportSnapshot } from '../api/types'
import { seedIssues, seedRuleVersions, seedRules, CURRENT_RULE_VERSION_ID } from '../api/seed'

type SavedFilter = { id: string; name: string; query: string; site: string; status: string; priority: string }

type WorkspaceState = {
  issues: Issue[]
  selectedKeys: string[]
  savedFilters: SavedFilter[]
  draft: string
  mergeKeys: string[]
  // 规则库
  rules: Rule[]
  ruleVersions: RuleVersion[]
  currentRuleVersionId: string
  // 重审批次
  batches: ReapprovalBatch[]
  // 整改报告快照
  reportSnapshot: ReportSnapshot | null
  setIssues: (issues: Issue[]) => void
  setSelectedKeys: (keys: string[]) => void
  saveFilter: (filter: Omit<SavedFilter, 'id'>) => void
  removeFilter: (id: string) => void
  setDraft: (draft: string) => void
  mergeIssues: (keys: string[]) => void
  updateIssue: (issue: Issue) => void
  setRuleLibrary: (lib: { rules: Rule[]; ruleVersions: RuleVersion[]; currentRuleVersionId: string }) => void
  setBatches: (batches: ReapprovalBatch[]) => void
  setReportSnapshot: (snapshot: ReportSnapshot) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      issues: structuredClone(seedIssues),
      selectedKeys: [],
      savedFilters: [
        { id: 'f1', name: 'P0/P1 未关闭', query: '', site: '', status: '', priority: 'P0' },
        { id: 'f2', name: '基础组件组待复测', query: '基础组件', site: '', status: '待复测', priority: '' },
      ],
      draft: 'A11Y-1048：需同时验证 Esc 关闭与 Tab/Shift+Tab 环绕顺序，移动端抽屉也需复测。',
      mergeKeys: [],
      rules: structuredClone(seedRules),
      ruleVersions: structuredClone(seedRuleVersions),
      currentRuleVersionId: CURRENT_RULE_VERSION_ID,
      batches: [],
      reportSnapshot: null,
      setIssues: (issues) => set({ issues }),
      setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
      saveFilter: (filter) => set((state) => ({ savedFilters: [...state.savedFilters, { ...filter, id: crypto.randomUUID() }] })),
      removeFilter: (id) => set((state) => ({ savedFilters: state.savedFilters.filter((item) => item.id !== id) })),
      setDraft: (draft) => set({ draft }),
      mergeIssues: (keys) =>
        set((state) => {
          const primary = state.issues.find((issue) => issue.key === keys[0])
          if (!primary) return state
          return {
            issues: state.issues.map((issue) =>
              keys.includes(issue.key)
                ? {
                    ...issue,
                    rootCause: primary.rootCause,
                    status: issue.key === primary.key ? issue.status : '不适用',
                    mergedKeys: issue.key === primary.key ? keys.slice(1) : [primary.key],
                    history: [...issue.history, { at: '刚刚', actor: '当前用户', action: '重复问题合并', detail: `合并至 ${primary.key}` }],
                  }
                : issue,
            ),
            selectedKeys: [],
          }
        }),
      updateIssue: (updated) => set((state) => ({ issues: state.issues.map((issue) => (issue.key === updated.key ? updated : issue)) })),
      setRuleLibrary: (lib) => set({ rules: lib.rules, ruleVersions: lib.ruleVersions, currentRuleVersionId: lib.currentRuleVersionId }),
      setBatches: (batches) => set({ batches }),
      setReportSnapshot: (reportSnapshot) => set({ reportSnapshot }),
    }),
    {
      name: 'accessibility-remediation-v1',
      version: 2,
    },
  ),
)
