import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Radio,
  Space,
  Statistic,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useReapprovalBatches, useReapprovalBatch, useReapprovalActions } from '../api/useReapproval'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { ReapprovalBatch, RereviewTask } from '../api/types'

const batchStatusColor: Record<ReapprovalBatch['status'], string> = {
  pending: 'default',
  processing: 'processing',
  completed: 'success',
  failed: 'error',
  conflicted: 'warning',
}
const batchStatusLabel: Record<ReapprovalBatch['status'], string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  conflicted: '冲突（未生效）',
}

const siteStatusColor: Record<string, string> = {
  pending: 'default',
  processing: 'processing',
  completed: 'success',
  failed: 'error',
}

export default function ReapprovalPage() {
  useReapprovalBatches()
  const batches = useWorkspaceStore((state) => state.batches)
  const [detailId, setDetailId] = useState<string | null>(null)

  const sorted = [...batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">REAPPROVAL / 重审批次</p>
          <h1>规则升级重审批次</h1>
          <p className="muted">按站点游标分批重算，失败后从断点恢复，已完成部分不重复生成任务。</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>批次列表</h3><Tag>{batches.length} 个批次</Tag></div>
        {sorted.length === 0 ? (
          <Empty description="暂无重审批次，可在规则库发布新版本" style={{ padding: 40 }} />
        ) : (
          <Table
            rowKey="id"
            dataSource={sorted}
            pagination={false}
            rowClassName={(r) => r.id === detailId ? 'ant-table-row-selected' : ''}
            onRow={(r) => ({ onClick: () => setDetailId(r.id) })}
            columns={[
              { title: '批次', dataIndex: 'id', width: 200, render: (v) => <Typography.Text code>{v}</Typography.Text> },
              { title: '规则版本', dataIndex: 'ruleVersion', width: 110, render: (v) => <Tag color="blue">{v}</Tag> },
              { title: '状态', dataIndex: 'status', width: 130, render: (v: ReapprovalBatch['status']) => <Badge status={batchStatusColor[v] as any} text={batchStatusLabel[v]} /> },
              {
                title: '站点进度',
                width: 180,
                render: (_, r) => {
                  const done = r.sites.filter((s) => s.status === 'completed').length
                  return <Progress percent={Math.round((done / r.sites.length) * 100)} size="small" />
                },
              },
              { title: '受影响问题', dataIndex: 'diff', width: 110, render: (d: ReapprovalBatch['diff']) => <Statistic value={d.affectedCount} valueStyle={{ fontSize: 16 }} /> },
              { title: '创建人', dataIndex: 'createdBy', width: 110 },
              { title: '创建时间', dataIndex: 'createdAt', width: 110 },
            ]}
          />
        )}
      </div>

      <BatchDetail batchId={detailId} onClose={() => setDetailId(null)} />
    </section>
  )
}

function BatchDetail({ batchId, onClose }: { batchId: string | null; onClose: () => void }) {
  const { data, isLoading } = useReapprovalBatch(batchId ?? undefined)
  const { advanceBatch, confirmTask } = useReapprovalActions()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activeTask, setActiveTask] = useState<RereviewTask | null>(null)
  const [form] = Form.useForm()
  const [advancing, setAdvancing] = useState(false)

  const batch = data?.batch
  const tasks = data?.tasks ?? []

  const openConfirm = (task: RereviewTask) => {
    setActiveTask(task)
    form.setFieldsValue({ result: '已通过', note: '' })
    setConfirmOpen(true)
  }

  const submitConfirm = async () => {
    const values = await form.validateFields()
    if (!activeTask) return
    await confirmTask(activeTask.id, values.result, values.note, '当前用户')
    message.success(`重审任务 ${activeTask.id} 已确认`)
    setConfirmOpen(false)
    setActiveTask(null)
  }

  const handleAdvance = async (simulateFailure: boolean) => {
    if (!batch) return
    setAdvancing(true)
    try {
      await advanceBatch(batch.id, simulateFailure)
      if (simulateFailure) message.warning('已模拟失败：游标保持，可点击"恢复"从断点继续')
      else message.success('已推进一个站点')
    } finally {
      setAdvancing(false)
    }
  }

  const pendingTasks = tasks.filter((t) => t.status === 'pending')
  const confirmedTasks = tasks.filter((t) => t.status === 'confirmed')

  return (
    <>
      <Drawer
        title={batch ? `批次 ${batch.id}` : '批次详情'}
        open={Boolean(batchId)}
        onClose={onClose}
        width={720}
        loading={isLoading}
        extra={
          batch && batch.status !== 'completed' && batch.status !== 'conflicted' ? (
            <Space>
              <Button icon={<ExclamationCircleOutlined />} onClick={() => handleAdvance(true)} loading={advancing}>模拟失败</Button>
              <Button type="primary" icon={batch.status === 'failed' ? <RedoOutlined /> : <PlayCircleOutlined />} onClick={() => handleAdvance(false)} loading={advancing}>
                {batch.status === 'failed' ? '恢复（从游标）' : '推进下一站点'}
              </Button>
            </Space>
          ) : null
        }
      >
        {batch && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {batch.status === 'conflicted' && (
              <Alert type="warning" showIcon message="该批次为并发冲突的后到者，未生效。" description={`胜出批次：${batch.conflictWith ?? '-'}。本批次保留了完整差异，可查看但不会重算问题。`} />
            )}
            {batch.status === 'failed' && (
              <Alert type="error" showIcon message="重算失败" description={`站点游标停留在第 ${batch.siteCursor + 1} 个站点，已完成站点不会重复生成任务。点击"恢复"从断点继续。`} />
            )}

            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="规则版本"><Tag color="blue">{batch.ruleVersion}</Tag></Descriptions.Item>
              <Descriptions.Item label="批次状态"><Badge status={batchStatusColor[batch.status] as any} text={batchStatusLabel[batch.status]} /></Descriptions.Item>
              <Descriptions.Item label="依据版本"><Typography.Text code>{batch.baseVersionId}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label="创建人">{batch.createdBy}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{batch.createdAt}</Descriptions.Item>
              <Descriptions.Item label="站点游标">{batch.siteCursor < 0 ? '未开始' : `第 ${batch.siteCursor + 1} / ${batch.sites.length} 个`}</Descriptions.Item>
            </Descriptions>

            <div>
              <Typography.Title level={5}>站点分批进度</Typography.Title>
              <Timeline
                items={batch.sites.map((s, i) => ({
                  color: siteStatusColor[s.status],
                  children: (
                    <div>
                      <Space>
                        <Typography.Text strong>{s.site}</Typography.Text>
                        <Tag color={siteStatusColor[s.status]}>{s.status === 'completed' ? '已完成' : s.status === 'failed' ? '失败' : s.status === 'processing' ? '处理中' : '待处理'}</Tag>
                        {s.affectedIssueKeys.length > 0 && <Tag color="red">{s.affectedIssueKeys.length} 项退出已通过</Tag>}
                      </Space>
                      {s.error && <div><Typography.Text type="danger">{s.error}</Typography.Text></div>}
                      {s.processedAt && <div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{s.processedAt}</Typography.Text></div>}
                    </div>
                  ),
                }))}
              />
            </div>

            <div>
              <Typography.Title level={5}>差异概览</Typography.Title>
              <Space wrap>
                <Statistic title="已通过总数" value={batch.diff.totalPassed} />
                <Statistic title="受影响" value={batch.diff.affectedCount} valueStyle={{ color: '#ba4d31' }} />
                <Statistic title="沿用原结论站点" value={batch.diff.unaffectedSites.length} />
              </Space>
              {batch.diff.unaffectedSites.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary">未受影响、沿用原结论的站点：</Typography.Text>
                  <Space wrap style={{ marginTop: 4 }}>{batch.diff.unaffectedSites.map((s) => <Tag key={s}>{s}</Tag>)}</Space>
                </div>
              )}
            </div>

            <div>
              <Typography.Title level={5}>受影响问题（退出已通过）</Typography.Title>
              <Table
                rowKey="issueKey"
                dataSource={batch.diff.items}
                pagination={false}
                size="small"
                columns={[
                  { title: '问题', dataIndex: 'issueKey', render: (v) => <Typography.Text strong>{v}</Typography.Text> },
                  { title: '站点', dataIndex: 'site', width: 110 },
                  { title: '旧结论', dataIndex: 'oldStatus', width: 90, render: (v) => <Tag color="success">{v}</Tag> },
                  { title: '新结论', dataIndex: 'newStatus', width: 90, render: (v) => <Tag color="orange">{v}</Tag> },
                  { title: '原因', dataIndex: 'reason' },
                ]}
              />
            </div>

            <div>
              <Typography.Title level={5}>
                重审任务
                <Tag style={{ marginLeft: 8 }}>{confirmedTasks.length}/{tasks.length} 已确认</Tag>
              </Typography.Title>
              {tasks.length === 0 ? (
                <Typography.Text type="secondary">批次处理后生成重审任务</Typography.Text>
              ) : (
                <Table
                  rowKey="id"
                  dataSource={tasks}
                  pagination={false}
                  size="small"
                  columns={[
                    { title: '任务', dataIndex: 'id', width: 180, render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text> },
                    { title: '问题', dataIndex: 'issueKey', width: 110, render: (v) => <Typography.Text strong>{v}</Typography.Text> },
                    { title: '站点', dataIndex: 'site', width: 110 },
                    { title: '旧结论', dataIndex: 'oldConclusion', width: 90, render: (v) => <Tag color="success">{v}</Tag> },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 100,
                      render: (v: RereviewTask['status'], r) => v === 'confirmed'
                        ? <Tag color="success" icon={<CheckCircleOutlined />}>{r.result}</Tag>
                        : <Tag color="warning" icon={<ClockCircleOutlined />}>待重审</Tag>,
                    },
                    {
                      title: '操作',
                      width: 100,
                      render: (_, r) => r.status === 'pending'
                        ? <Button size="small" type="primary" onClick={() => openConfirm(r)}>确认重审</Button>
                        : <Typography.Text type="secondary" style={{ fontSize: 11 }}>{r.confirmedBy} · {r.confirmedAt}</Typography.Text>,
                    },
                  ]}
                />
              )}
            </div>
          </Space>
        )}
      </Drawer>

      <Modal title="确认重审结论" open={confirmOpen} onCancel={() => setConfirmOpen(false)} onOk={submitConfirm} okText="确认">
        {activeTask && (
          <>
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`${activeTask.issueKey} · 旧结论：${activeTask.oldConclusion}`} description="规则升级后需按新规则重新评审。确认后问题状态与报告快照将更新。" />
            <Form form={form} layout="vertical">
              <Form.Item name="result" label="重审结论" rules={[{ required: true }]}>
                <Radio.Group>
                  <Radio.Button value="已通过">通过</Radio.Button>
                  <Radio.Button value="已退回">退回</Radio.Button>
                  <Radio.Button value="不适用">不适用</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="note" label="重审记录" rules={[{ required: true, message: '请填写重审依据' }]}>
                <Input.TextArea rows={3} placeholder="记录按新规则验证的结果" />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </>
  )
}
