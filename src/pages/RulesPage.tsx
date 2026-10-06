import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useRules, useReapprovalActions } from '../api/useReapproval'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { RuleChange, RuleChangeType } from '../api/types'

const changeColor: Record<RuleChangeType, string> = { 收紧: 'red', 新增: 'blue', 澄清: 'default' }

export default function RulesPage() {
  useRules()
  const rules = useWorkspaceStore((state) => state.rules)
  const ruleVersions = useWorkspaceStore((state) => state.ruleVersions)
  const currentRuleVersionId = useWorkspaceStore((state) => state.currentRuleVersionId)
  const issues = useWorkspaceStore((state) => state.issues)
  const { releaseRule, backfill } = useReapprovalActions()

  const [releaseOpen, setReleaseOpen] = useState(false)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const currentVersion = ruleVersions.find((v) => v.id === currentRuleVersionId)
  const passedCount = issues.filter((i) => i.status === '已通过').length
  const missingVersionCount = issues.filter((i) => !i.ruleVersionId).length

  const ruleOptions = useMemo(() => rules.map((r) => ({ value: r.wcag })), [rules])

  const openRelease = () => {
    form.setFieldsValue({
      version: '',
      label: '',
      changes: [{ wcag: undefined, changeType: '收紧', detail: '' }],
    })
    setReleaseOpen(true)
  }

  const submitRelease = async () => {
    const values = await form.validateFields()
    const changes: RuleChange[] = (values.changes ?? []).filter((c: RuleChange) => c.wcag).map((c: RuleChange) => ({
      wcag: c.wcag,
      changeType: c.changeType,
      detail: c.detail ?? '',
    }))
    if (changes.length === 0) {
      message.warning('请至少选择一条变更规则')
      return
    }
    setSubmitting(true)
    try {
      const result = await releaseRule({
        version: values.version,
        label: values.label || `规则库 ${values.version}`,
        changes,
        baseVersionId: currentRuleVersionId,
        releasedBy: '当前用户',
      })
      if (result.conflict) {
        message.warning(`发布冲突：已有更新版本生效，本次发布保留为批次 ${result.batch.id}（差异已保存）`)
      } else {
        message.success(`规则库已升级至 ${values.version}，重审批次 ${result.batch.id} 已创建`)
        if (result.backfilled > 0) message.info(`已回填 ${result.backfilled} 条问题的规则版本`)
      }
      setReleaseOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleBackfill = async () => {
    const result = await backfill()
    if (result.backfilled > 0) message.success(`已回填 ${result.backfilled} 条问题的规则版本`)
    else message.info('所有问题均已有规则版本')
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">RULE LIBRARY / 规则库</p>
          <h1>无障碍规则库与版本发布</h1>
          <p className="muted">规则升级后，相关旧结论立即失效并按站点分批重算。</p>
        </div>
        <Space>
          <Button onClick={handleBackfill}>回填缺失版本</Button>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={openRelease}>发布新版本</Button>
        </Space>
      </div>

      {missingVersionCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`${missingVersionCount} 条问题缺少规则版本`}
          description="发布新版本时将自动回填首版规则版本，也可点击右上角按钮手动回填。"
        />
      )}

      <div className="metric-grid">
        <div className="metric-card"><span>当前版本</span><strong style={{ fontSize: 22 }}>{currentVersion?.version ?? '-'}</strong><small>{currentVersion?.label}</small></div>
        <div className="metric-card"><span>生效规则</span><strong>{rules.filter((r) => r.status === 'active').length}</strong><small>条 WCAG 规则</small></div>
        <div className="metric-card"><span>已通过问题</span><strong>{passedCount}</strong><small>可能受规则升级影响</small></div>
        <div className="metric-card"><span>版本历史</span><strong>{ruleVersions.length}</strong><small>个发布版本</small></div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head"><h3>当前规则</h3></div>
        <Table
          rowKey="id"
          dataSource={rules}
          pagination={false}
          columns={[
            { title: 'WCAG 条款', dataIndex: 'wcag', render: (v) => <Typography.Text strong>{v}</Typography.Text> },
            { title: '引入版本', dataIndex: 'introducedVersion', width: 140, render: (v) => ruleVersions.find((rv) => rv.id === v)?.version ?? v },
            { title: '状态', dataIndex: 'status', width: 90, render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '生效中' : '已退役'}</Tag> },
          ]}
        />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>版本历史</h3><Tag color="blue">当前 {currentVersion?.version}</Tag></div>
        <Table
          rowKey="id"
          dataSource={[...ruleVersions].reverse()}
          pagination={false}
          columns={[
            { title: '版本', dataIndex: 'version', width: 120, render: (v, r) => <Typography.Text strong>{v}</Typography.Text> },
            { title: '说明', dataIndex: 'label' },
            { title: '发布人', dataIndex: 'releasedBy', width: 120 },
            { title: '发布时间', dataIndex: 'releasedAt', width: 140 },
            { title: '变更', dataIndex: 'changes', render: (changes: RuleChange[]) => changes.length ? <Space wrap>{changes.map((c, i) => <Tag key={i} color={changeColor[c.changeType]}>{c.wcag} · {c.changeType}</Tag>)}</Space> : <Typography.Text type="secondary">首版</Typography.Text> },
            { title: '状态', dataIndex: 'status', width: 90, render: (v) => <Tag color={v === 'current' ? 'green' : 'default'}>{v === 'current' ? '当前' : '已替代'}</Tag> },
          ]}
        />
      </div>

      <Modal title="发布规则新版本" open={releaseOpen} onCancel={() => setReleaseOpen(false)} onOk={submitRelease} confirmLoading={submitting} okText="发布并重算" width={640}>
        <Alert type="info" showIcon style={{ marginBottom: 14 }} message="发布后将立即创建重审批次，按站点分批重算受影响的已通过问题。" />
        <Form form={form} layout="vertical">
          <Space style={{ display: 'flex' }}>
            <Form.Item name="version" label="新版本号" rules={[{ required: true, message: '如 2026.10' }]} style={{ flex: 1 }}>
              <Input placeholder="如 2026.10" />
            </Form.Item>
            <Form.Item name="label" label="版本说明" style={{ flex: 1 }}>
              <Input placeholder="可选" />
            </Form.Item>
          </Space>
          <Form.List name="changes">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item {...field} name={[field.name, 'wcag']} rules={[{ required: true, message: '选择规则' }]} style={{ width: 220 }}>
                      <Select placeholder="WCAG 条款" options={ruleOptions} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'changeType']} style={{ width: 110 }}>
                      <Select options={[{ value: '收紧' }, { value: '新增' }, { value: '澄清' }]} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'detail']} style={{ flex: 1 }}>
                      <Input placeholder="变更说明" />
                    </Form.Item>
                    <Button type="text" danger onClick={() => remove(field.name)}>删除</Button>
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} block>添加变更规则</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </section>
  )
}
