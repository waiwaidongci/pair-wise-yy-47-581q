import { useState } from 'react'
import { Alert, Button, Checkbox, Select, Space, Tag, Typography, message } from 'antd'
import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons'
import { useIssues } from '../api/useIssues'
import { useReportSnapshot, useReapprovalBatches } from '../api/useReapproval'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export default function ReportPage() {
  useIssues()
  useReportSnapshot()
  useReapprovalBatches()
  const issues = useWorkspaceStore((state) => state.issues)
  const reportSnapshot = useWorkspaceStore((state) => state.reportSnapshot)
  const batches = useWorkspaceStore((state) => state.batches)
  const [site, setSite] = useState('全部站点')
  const [includeEvidence, setIncludeEvidence] = useState(true)
  const [includeHistory, setIncludeHistory] = useState(true)

  // 报告沿用发布快照结论；重审未确认前不随台账实时变动
  const processingBatch = batches.find((b) => b.status === 'processing' || b.status === 'failed')
  const publishedMap = reportSnapshot?.conclusions ?? {}
  const visible = issues.filter((item) => site === '全部站点' || item.site === site)

  // 报告中展示的结论：优先取快照，缺失时回退到当前状态
  const conclusionOf = (issue: typeof issues[number]) => publishedMap[issue.key] ?? { status: issue.status, passed: issue.status === '已通过' }

  const exportCsv = () => {
    const rows = [
      ['编号', '站点', '版本', '问题', 'WCAG', '影响', '报告结论', '团队', '负责人', '截止日期'],
      ...visible.map((issue) => {
        const c = conclusionOf(issue)
        return [issue.key, issue.site, issue.version, issue.title, issue.wcag.join(' / '), issue.impact, c.status, issue.team, issue.owner, issue.dueDate]
      }),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `无障碍整改报告-${site}.csv`
    link.click()
    URL.revokeObjectURL(url)
    message.success('报告已导出')
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">REPORT / 整改报告</p>
          <h1>可追溯的站点整改报告</h1>
          <p className="muted">按站点、版本和状态汇总问题；重审未确认前报告保持上一版结论。</p>
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>导出 CSV</Button>
          <Button type="primary" icon={<FilePdfOutlined />} onClick={() => window.print()}>打印 / PDF</Button>
        </Space>
      </div>

      {processingBatch && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message={`重审批次 ${processingBatch.id} 进行中，报告沿用 ${reportSnapshot?.publishedAt ?? '上一版'} 结论`}
          description="规则升级已使部分旧结论失效并重算中；在重审任务确认前，整改报告保持上一版发布结论，确认后自动更新。"
        />
      )}

      <div className="panel" style={{ padding: 12, marginBottom: 14 }}>
        <Space wrap>
          <span>报告范围</span>
          <Select value={site} onChange={setSite} style={{ width: 150 }} options={['全部站点', ...new Set(issues.map((item) => item.site))].map((value) => ({ value }))} />
          <Checkbox checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)}>包含证据链接</Checkbox>
          <Checkbox checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)}>包含操作历史</Checkbox>
        </Space>
      </div>

      <article className="panel report-sheet">
        <header style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid #173e4d', paddingBottom: 16 }}>
          <div><Typography.Text type="secondary">数字体验无障碍治理项目</Typography.Text><h2>网站无障碍整改报告</h2><Typography.Text>生成日期：{reportSnapshot?.publishedAt ?? '—'} · WCAG 2.2 AA</Typography.Text></div>
          <div style={{ textAlign: 'right' }}><Tag color="blue">{site}</Tag><div>问题 {visible.length} 项</div><div>通过 {visible.filter((item) => conclusionOf(item).passed).length} 项</div></div>
        </header>
        <table>
          <thead><tr><th>编号</th><th>页面 / 范围</th><th>问题与 WCAG</th><th>影响</th><th>报告结论 / 责任</th><th>截止</th></tr></thead>
          <tbody>
            {visible.map((issue) => {
              const c = conclusionOf(issue)
              return (
                <tr key={issue.key}>
                  <td>{issue.key}</td>
                  <td>{issue.site}<br /><Typography.Text type="secondary">{issue.version}</Typography.Text></td>
                  <td><strong>{issue.title}</strong><br />{issue.wcag.join(' / ')}{includeEvidence && <><br /><Typography.Link href={issue.evidence}>查看证据</Typography.Link></>}</td>
                  <td><Tag color={issue.impact === '致命' ? 'red' : issue.impact === '严重' ? 'volcano' : 'gold'}>{issue.impact}</Tag></td>
                  <td>
                    <Space direction="vertical" size={2}>
                      <Tag color={c.passed ? 'success' : c.status === '已退回' ? 'error' : 'default'}>{c.status}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{issue.team} / {issue.owner}</Typography.Text>
                    </Space>
                  </td>
                  <td>{issue.dueDate}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {includeHistory && <div style={{ marginTop: 20 }}><Typography.Title level={5}>最近操作记录</Typography.Title>{visible.flatMap((issue) => issue.history.slice(-1).map((event) => <div className="timeline-item" key={`${issue.key}-${event.at}`}><strong>{issue.key} · {event.action}</strong><div>{event.detail}</div><span className="muted">{event.actor} · {event.at}</span></div>))}</div>}
      </article>
    </section>
  )
}
