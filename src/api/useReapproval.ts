import { useEffect } from 'react'
import axios from 'axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { Rule, RuleVersion, ReapprovalBatch, RereviewTask, ReportSnapshot } from './types'

// ─── 规则库 ───────────────────────────────────────────────

export function useRules() {
  const setRuleLibrary = useWorkspaceStore((state) => state.setRuleLibrary)
  const query = useQuery({
    queryKey: ['rules'],
    queryFn: async () => (await axios.get<{ rules: Rule[]; ruleVersions: RuleVersion[]; currentRuleVersionId: string }>('/api/rules')).data,
  })

  useEffect(() => {
    if (query.data) setRuleLibrary(query.data)
  }, [query.data, setRuleLibrary])

  return query
}

// ─── 重审批次列表 ─────────────────────────────────────────

export function useReapprovalBatches() {
  const setBatches = useWorkspaceStore((state) => state.setBatches)
  const query = useQuery({
    queryKey: ['reapproval-batches'],
    queryFn: async () => (await axios.get<ReapprovalBatch[]>('/api/reapproval-batches')).data,
  })

  useEffect(() => {
    if (query.data) setBatches(query.data)
  }, [query.data, setBatches])

  return query
}

// ─── 单个批次详情（含任务） ───────────────────────────────

export function useReapprovalBatch(batchId: string | undefined) {
  return useQuery({
    queryKey: ['reapproval-batch', batchId],
    queryFn: async () => (await axios.get<{ batch: ReapprovalBatch; tasks: RereviewTask[] }>(`/api/reapproval-batches/${batchId}`)).data,
    enabled: Boolean(batchId),
    refetchInterval: (query) => {
      const status = query.state.data?.batch?.status
      return status === 'processing' || status === 'failed' ? 1500 : false
    },
  })
}

// ─── 整改报告快照 ─────────────────────────────────────────

export function useReportSnapshot() {
  const setReportSnapshot = useWorkspaceStore((state) => state.setReportSnapshot)
  const query = useQuery({
    queryKey: ['report-snapshot'],
    queryFn: async () => (await axios.get<ReportSnapshot>('/api/report-snapshot')).data,
  })

  useEffect(() => {
    if (query.data) setReportSnapshot(query.data)
  }, [query.data, setReportSnapshot])

  return query
}

// ─── 操作：发布规则、推进批次、确认任务 ──────────────────

export function useReapprovalActions() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['rules'] })
    queryClient.invalidateQueries({ queryKey: ['reapproval-batches'] })
    queryClient.invalidateQueries({ queryKey: ['reapproval-batch'] })
    queryClient.invalidateQueries({ queryKey: ['report-snapshot'] })
    queryClient.invalidateQueries({ queryKey: ['issues'] })
  }

  const releaseRule = async (input: {
    version: string
    label: string
    changes: Array<{ wcag: string; changeType: '收紧' | '新增' | '澄清'; detail: string }>
    baseVersionId: string
    releasedBy: string
  }) => {
    try {
      const { data } = await axios.post('/api/rules/release', input)
      invalidate()
      return { conflict: false as const, ...data }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        invalidate()
        return { conflict: true as const, batch: err.response.data.batch }
      }
      throw err
    }
  }

  const advanceBatch = async (batchId: string, simulateFailure = false) => {
    const { data } = await axios.post(`/api/reapproval-batches/${batchId}/advance`, { simulateFailure })
    invalidate()
    return data
  }

  const confirmTask = async (taskId: string, result: '已通过' | '已退回' | '不适用', note: string, confirmedBy: string) => {
    const { data } = await axios.post(`/api/rereview-tasks/${taskId}/confirm`, { result, note, confirmedBy })
    invalidate()
    return data
  }

  const backfill = async () => {
    const { data } = await axios.post('/api/rules/backfill')
    invalidate()
    return data
  }

  return { releaseRule, advanceBatch, confirmTask, backfill }
}
