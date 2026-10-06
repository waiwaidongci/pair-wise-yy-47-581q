import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import type { ReReviewBatch, ReReviewTask, RuleVersion } from './types'

export function useRules() {
  return useQuery({
    queryKey: ['rules'],
    queryFn: async () => (await axios.get<{ versions: RuleVersion[]; currentRevision: number }>('/api/rules')).data,
  })
}

export function useBatches() {
  return useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await axios.get<ReReviewBatch[]>('/api/batches')).data,
  })
}

export function useReReviewTasks() {
  return useQuery({
    queryKey: ['rereview-tasks'],
    queryFn: async () => (await axios.get<ReReviewTask[]>('/api/rereview-tasks')).data,
  })
}
