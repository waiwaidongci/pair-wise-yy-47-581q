import { useState } from 'react'
import axios from 'axios'
import dayjs from 'dayjs'
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CloudUploadOutlined, DeleteOutlined, PlusOutlined, RedoOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useIssues } from '../api/useIssues'
import { useBatches, useReReviewTasks, useRules } from '../api/useRules'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { ReReviewBatch, ReReviewTask, RuleChange, RuleVersion, SiteProgress } from '../api/types'

const batchStatusColor: Record<ReReviewBatch['status'], string> = { 进行中: 'processing', 已完成: 'success', 失败: 'error', 冲突保留: 'warning' }
const siteStatusColor: Record<SiteProgress['status'], string> = { 待处理: 'default', 已完成: 'success', 失败: 'error' }

const defaultChanges = (): RuleChange[] => [
  { wcag: '2.4.3 焦点顺序', field: '判定标准', before: '关闭后焦点返回触发元素即视为通过', after: '需返回触发元素，且 Shift+Tab 反向遍历顺序一致' },
  { wcag: '2.1.2 无键盘陷阱', field: '影响等级', before: '按严重处理', after: '统一上调为致命', newImpact: '致命' },
]

export default function RulesPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const setIssues = useWorkspaceStore((state) => state.setIssues)
  const queryClient = useQueryClient()
  const { data: rules } = useRules()
  const { data: batches } = useBatches()
  const { data: tasks } = useReReviewTasks()
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [simulate, setSimulate] = useState(true)
  const [baseRevision, setBaseRevision] = useState(1)
  const [formDefaults, setFormDefaults] = useState<{ id: string; actor: string; changes: RuleChange[] }>({ id: '', actor: '', changes: [] })
  const [form] = Form.useForm()

  const versions = rules?.versions ?? []
  const current = versions.reduce<RuleVersion | null>((latest, item) => (item.revision > (latest?.revision ?? 0) ? item : latest), null)
  const wcagOptions = [...new Set(issues.flatMap((issue) => issue.wcag))].map((value) => ({ value }))
  const failedBatches = (batches ?? []).filter((batch) => batch.status === '失败')
  const pendingTasks = (tasks ?? []).filter((task) => task.status === '待确认')

  const syncIssues = (data: { issues: typeof issues; tasks: ReReviewTask[] }) => {
    queryClient.setQueryData(['issues'], data.issues)
    setIssues(data.issues)
    queryClient.setQueryData(['rereview-tasks'], data.tasks)
  }

  const runBatchNow = async (batchId: string, resume: boolean) => {
    setRunningId(batchId)
    try {
      const { data } = await axios.post(`/api/batches/${batchId}/run`, { resume })
      syncIssues(data)
      await queryClient.invalidateQueries({ queryKey: ['batches'] })
      return data.batch as ReReviewBatch
    } finally {
      setRunningId(null)
    }
  }

  const resume = async (batch: ReReviewBatch) => {
    const result = await runBatchNow(batch.id, true)
    if (result.status === '已完成') message.success(`批次 ${batch.id} 已从站点游标恢复并完成，已完成站点未重复生成任务`)
    else message.warning(result.error ?? '批次仍未完成')
  }

  const openPublish = () => {
    setBaseRevision(rules?.currentRevision ?? 1)
    const base = `RV-${dayjs().format('YYYY.MM')}`
    const ids = new Set(versions.map((version) => version.id))
    let suggestion = base
    let seq = 2
    while (ids.has(suggestion)) suggestion = `${base}-r${seq++}`
    setFormDefaults({ id: suggestion, actor: '李予 / 审核员', changes: defaultChanges() })
    setPublishOpen(true)
  }

  const publish = async () => {
    const values = (await form.validateFields()) as { id: string; actor: string; changes: RuleChange[] }
    setPublishing(true)
    try {
      const payload = { id: values.id, changes: values.changes, baseRevision, actor: values.actor }
      // 模拟两人基于同一修订同时提交：先到者生效，后到者保留批次和差异
      const requests = simulate
        ? [
            axios.post('/api/rules/publish', payload),
            axios.post('/api/rules/publish', { ...payload, actor: '苏禾 / 审核员', changes: values.changes.map((change) => ({ ...change, after: `${change.after}（苏禾补充：覆盖移动端）` })) }),
          ]
        : [axios.post('/api/rules/publish', payload)]

      const results = await Promise.allSettled(requests)
      let publishedBatchId: string | null = null
      for (const result of results) {
        if (result.status === 'fulfilled') {
          publishedBatchId = result.value.data.batch.id
          message.success(`${result.value.data.batch.createdBy} 的发布已生效：${result.value.data.version.id}（修订 ${result.value.data.currentRevision}），相关旧结论开始失效重算`)
        } else if (axios.isAxiosError(result.reason) && result.reason.response?.status === 409) {
          const kept = result.reason.response.data.keptBatch
          message.warning(`${kept.createdBy} 的提交未生效：规则库已被他人更新，批次 ${kept.id} 与差异已保留`)
        } else {
          message.error('发布失败，请重试')
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['rules'] })
      await queryClient.invalidateQueries({ queryKey: ['batches'] })

      if (publishedBatchId) {
        const batch = await runBatchNow(publishedBatchId, false)
        if (batch.status === '失败') message.warning(batch.error)
        else message.success(`批次 ${batch.id} 重算完成：${batch.sites.flatMap((site) => site.affectedKeys).length} 项退出已通过，${batch.sites.flatMap((site) => site.backfilledKeys).length} 项回填首版`)
      }
      setPublishOpen(false)
    } finally {
      setPublishing(false)
    }
  }

  const confirm = async (task: ReReviewTask) => {
    setConfirmingId(task.id)
    try {
      const { data } = await axios.post(`/api/rereview-tasks/${task.id}/confirm`)
      syncIssues(data)
      message.success(`任务 ${task.id} 已确认，报告切换至 ${task.ruleVersionId} 结论`)
    } finally {
      setConfirmingId(null)
    }
  }

  const batchColumns: ColumnsType<ReReviewBatch> = [
    { title: '批次', dataIndex: 'id', width: 150, render: (_, record) => <div><Typography.Text strong>{record.id}</Typography.Text><div className="muted" style={{ fontSize: 11 }}>{record.createdBy} · {record.createdAt}</div></div> },
    { title: '规则版本', dataIndex: 'ruleVersionId', width: 150, render: (value, record) => <Space size={4}><Typography.Text code>{value}</Typography.Text>{record.status === '冲突保留' && <Tag color="warning">未生效</Tag>}</Space> },
    { title: '状态', dataIndex: 'status', width: 150, render: (_, record) => <div><Tag color={batchStatusColor[record.status]}>{record.status}</Tag>{record.error && <div className="muted" style={{ fontSize: 11, marginTop: 4, maxWidth: 260 }}>{record.error}</div>}</div> },
    {
      title: '站点进度（游标）',
      width: 300,
      render: (_, record) =>
        record.sites.length === 0 ? '—' : (
          <Space size={4} wrap>
            <Typography.Text type="secondary">{record.cursor}/{record.sites.length}</Typography.Text>
            {record.sites.map((site) => <Tag key={site.site} color={siteStatusColor[site.status]}>{site.site}</Tag>)}
          </Space>
        ),
    },
    { title: '退出已通过 / 任务', width: 130, render: (_, record) => (record.sites.length === 0 ? '—' : `${record.sites.flatMap((site) => site.affectedKeys).length} 项 / ${record.sites.flatMap((site) => site.taskIds).length} 个`) },
    {
      title: '操作',
      width: 130,
      render: (_, record) =>
        record.status === '失败' ? (
          <Button size="small" type="primary" icon={<RedoOutlined />} loading={runningId === record.id} onClick={() => resume(record)}>从断点恢复</Button>
        ) : record.status === '冲突保留' ? (
          <Tooltip title="该提交基于旧修订，未生效；差异已保留，可基于最新修订重新发布"><Typography.Text type="secondary">差异已保留</Typography.Text></Tooltip>
        ) : null,
    },
  ]

  const taskColumns: ColumnsType<ReReviewTask> = [
    { title: '任务', dataIndex: 'id', width: 90, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '问题', dataIndex: 'issueKey', width: 190, render: (value, record) => <div>{value}<div className="muted" style={{ fontSize: 11 }}>{record.site}</div></div> },
    { title: '上一版结论（报告沿用中）', width: 220, render: (_, record) => <div>{record.previousStatus} / {record.previousImpact}<div className="muted" style={{ fontSize: 11 }}>{record.previousRuleVersion}</div></div> },
    { title: '目标规则', dataIndex: 'ruleVersionId', width: 120, render: (value) => <Typography.Text code>{value}</Typography.Text> },
    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag color={value === '待确认' ? 'orange' : 'success'}>{value}</Tag> },
    {
      title: '操作',
      width: 120,
      render: (_, record) =>
        record.status === '待确认' ? (
          <Popconfirm title="确认后整改报告切换至新版结论" onConfirm={() => confirm(record)}>
            <Button size="small" type="primary" loading={confirmingId === record.id}>确认重审</Button>
          </Popconfirm>
        ) : (
          <Typography.Text type="secondary">{record.confirmedAt}</Typography.Text>
        ),
    },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">RULE GOVERNANCE / 规则治理</p>
          <h1>规则发布与重审批次</h1>
          <p className="muted">发布后相关旧结论立即失效，按站点分批重算；仅受影响的「已通过」问题退出并生成重审任务，确认前报告沿用上一版结论。</p>
        </div>
        <Space>
          {current && <Tag color="blue">当前规则库 {current.id} · 修订 {current.revision}</Tag>}
          <Button type="primary" icon={<CloudUploadOutlined />} onClick={openPublish}>发布新规则版本</Button>
        </Space>
      </div>

      {failedBatches.map((batch) => (
        <Alert key={batch.id} type="error" showIcon style={{ marginBottom: 12 }} message={`批次 ${batch.id} 重算中断`} description={batch.error} action={<Button size="small" danger loading={runningId === batch.id} onClick={() => resume(batch)}>从断点恢复</Button>} />
      ))}
      {pendingTasks.length > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${pendingTasks.length} 项重审任务待确认`} description="确认前整改报告保持上一版结论；在下方任务列表确认，或在复测工作台提交复测结果自动确认。" />
      )}

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head"><h3>规则版本</h3><span className="muted">并发提交以修订号判定，先到者生效</span></div>
        <Table
          rowKey="id"
          dataSource={versions}
          pagination={false}
          columns={[
            { title: '版本', dataIndex: 'id', width: 170, render: (value, record) => <Space size={6}><Typography.Text strong>{value}</Typography.Text>{record.revision === current?.revision && <Tag color="blue">当前</Tag>}</Space> },
            { title: '修订号', dataIndex: 'revision', width: 80 },
            { title: '发布人', dataIndex: 'publishedBy', width: 140 },
            { title: '发布时间', dataIndex: 'publishedAt', width: 110 },
            { title: '规则差异', render: (_, record) => (record.changes.length ? record.changes.map((change) => `${change.wcag}（${change.field}）`).join('、') : '基线版本') },
            { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag color="success">{value}</Tag> },
          ]}
        />
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head"><h3>重审批次</h3><span className="muted">按站点游标推进，失败可恢复且幂等</span></div>
        <Table
          rowKey="id"
          dataSource={batches ?? []}
          pagination={false}
          columns={batchColumns}
          scroll={{ x: 1000 }}
          expandable={{
            rowExpandable: (record) => record.sites.length > 0 || record.changes.length > 0,
            expandedRowRender: (record) =>
              record.status === '冲突保留' ? (
                <div>
                  <Typography.Text strong>保留的规则差异（未生效）</Typography.Text>
                  <Table
                    rowKey={(change) => `${change.wcag}-${change.field}`}
                    dataSource={record.changes}
                    pagination={false}
                    size="small"
                    style={{ marginTop: 8 }}
                    columns={[
                      { title: 'WCAG 条款', dataIndex: 'wcag', width: 170 },
                      { title: '变更项', dataIndex: 'field', width: 100 },
                      { title: '旧口径', dataIndex: 'before', width: 260 },
                      { title: '新口径', dataIndex: 'after' },
                    ]}
                  />
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {record.sites.map((site) => (
                    <div key={site.site} style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Tag color={siteStatusColor[site.status]}>{site.status}</Tag>
                      <Typography.Text strong style={{ width: 80 }}>{site.site}</Typography.Text>
                      <span>退出已通过：{site.affectedKeys.length ? site.affectedKeys.join('、') : '无'}</span>
                      <span>回填首版：{site.backfilledKeys.length ? site.backfilledKeys.join('、') : '无'}</span>
                      <span>重审任务：{site.taskIds.length ? site.taskIds.join('、') : '无'}</span>
                    </div>
                  ))}
                </div>
              ),
          }}
          locale={{ emptyText: '暂无批次，发布新规则版本后自动创建' }}
        />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>重审任务</h3><span className="muted">确认前报告保持上一版结论</span></div>
        <Table rowKey="id" dataSource={tasks ?? []} pagination={false} columns={taskColumns} scroll={{ x: 900 }} locale={{ emptyText: '暂无重审任务' }} />
      </div>

      <Modal title="发布新规则版本" open={publishOpen} onCancel={() => setPublishOpen(false)} onOk={() => form.submit()} okText="发布并重算" confirmLoading={publishing} width={860} destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 14 }} message="发布即创建重审批次" description="相关旧结论立即失效并按站点分批重算；只有受影响的「已通过」问题会退出原状态并生成重审任务，其余站点与问题沿用原结论。" />
        <Form form={form} layout="vertical" initialValues={formDefaults} onFinish={publish}>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="id" label="版本号" rules={[{ required: true, message: '请输入版本号' }]} style={{ width: 220 }}><Input placeholder="RV-2026.10" /></Form.Item>
            <Form.Item name="actor" label="发布人" rules={[{ required: true, message: '请输入发布人' }]} style={{ width: 220 }}><Input /></Form.Item>
            <Form.Item label="基准修订号"><Typography.Text code>{baseRevision}</Typography.Text></Form.Item>
          </Space>
          <Form.List name="changes">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap style={{ display: 'flex', marginBottom: 4 }}>
                    <Form.Item name={[field.name, 'wcag']} rules={[{ required: true, message: '选择条款' }]}><Select placeholder="WCAG 条款" style={{ width: 190 }} options={wcagOptions} /></Form.Item>
                    <Form.Item name={[field.name, 'field']} rules={[{ required: true }]}><Select style={{ width: 110 }} options={['判定标准', '影响等级', '适用范围'].map((value) => ({ value }))} /></Form.Item>
                    <Form.Item name={[field.name, 'before']}><Input placeholder="旧口径" style={{ width: 180 }} /></Form.Item>
                    <Form.Item name={[field.name, 'after']}><Input placeholder="新口径" style={{ width: 200 }} /></Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, curr) => prev.changes?.[field.name]?.field !== curr.changes?.[field.name]?.field}>
                      {({ getFieldValue }) =>
                        getFieldValue(['changes', field.name, 'field']) === '影响等级' ? (
                          <Form.Item name={[field.name, 'newImpact']} rules={[{ required: true, message: '选择新等级' }]}>
                            <Select placeholder="新等级" style={{ width: 100 }} options={['致命', '严重', '中等', '轻微'].map((value) => ({ value }))} />
                          </Form.Item>
                        ) : null
                      }
                    </Form.Item>
                    <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ field: '判定标准' })}>添加规则差异</Button>
              </>
            )}
          </Form.List>
          <Form.Item label="模拟双人同时提交" style={{ marginTop: 16 }}>
            <Switch checked={simulate} onChange={setSimulate} />
            {simulate && <Typography.Text type="secondary" style={{ marginLeft: 10 }}>以「李予」与「苏禾」基于同一修订并发提交，先到者生效，后到者批次与差异保留</Typography.Text>}
          </Form.Item>
        </Form>
      </Modal>
    </section>
  )
}
