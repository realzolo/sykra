# spec-axis — 项目指南

## 通用规则

- **回复语言**: 永远使用中文回复

## 项目概述

Next.js 16 + React 19 + TypeScript 的 AI 代码审查平台，使用 HeroUI v3（beta）+ Tailwind CSS v4。
支持多 GitHub 项目管理、提交选择、Claude AI 分析、可配置规则集、质量报告评分。
UI 使用 HeroUI v3 复合组件 API + lucide-react，全中文界面，白色主题，左对齐的 Supabase Dashboard 风格。

## 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| Next.js | 16.1.6 | App Router，Turbopack 构建 |
| React | 19.2.3 | — |
| HeroUI | 3.0.0-beta.8 | UI 组件库（`@heroui/react`） |
| Tailwind CSS | v4.2.1 | `@tailwindcss/postcss`，通过 `@import "@heroui/styles"` 引入 |
| framer-motion | ^12 | HeroUI 动画依赖 |
| tw-animate-css | ^1.4 | HeroUI 样式依赖 |
| Supabase | `@supabase/ssr ^0.9` | 数据库 + 认证 |
| Octokit | `^5.0.5` | GitHub API |
| Anthropic SDK | `^0.78` | Claude AI 分析，支持 `ANTHROPIC_BASE_URL` 自定义端点 |
| sonner | ^2 | Toast 通知 |
| zod | `^4.3.6` | 运行时类型验证 |
| lucide-react | ^0.577 | 图标库 |

## HeroUI v3 关键配置

### globals.css

```css
@import "@heroui/styles";

@layer base {
  body {
    font-family: Arial, Helvetica, sans-serif;
  }
}
```

**不需要** `tailwind.config.ts` 中的 `heroui()` plugin（v3 不使用）。
**不需要** `HeroUIProvider` 包装（v3 不需要）。

### .npmrc

```
public-hoist-pattern[]=*@heroui/*
```

必须配置，否则 HeroUI 包不会被正确 hoist。

### Progress 组件

HeroUI v3 beta 中**不存在** Progress 组件，用 Tailwind 实现：

```tsx
<div className="h-1 rounded-full bg-muted overflow-hidden">
  <div className="h-full rounded-full bg-success" style={{ width: `${value}%` }} />
</div>
```

## HeroUI v3 组件 API（已验证）

### 复合组件结构

```tsx
// Card
<Card>
  <Card.Header><Card.Title>标题</Card.Title></Card.Header>
  <Card.Content className="p-4">内容</Card.Content>
</Card>

// Modal
<Modal state={modalState}>
  <Modal.Backdrop isDismissable>
    <Modal.Container size="md">  {/* xs | sm | md | lg | full | cover */}
      <Modal.Dialog>
        <Modal.Header><Modal.Heading>标题</Modal.Heading></Modal.Header>
        <Modal.Body>内容</Modal.Body>
        <Modal.Footer>页脚</Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
</Modal>

// Tabs（不要用 <Tabs.Indicator />，会报 SharedElement 运行时错误）
<Tabs defaultSelectedKey="tab1">
  <Tabs.ListContainer className="border-b border-border px-4">
    <Tabs.List>
      <Tabs.Tab id="tab1">Tab 1</Tabs.Tab>
    </Tabs.List>
  </Tabs.ListContainer>
  <Tabs.Panel id="tab1">内容</Tabs.Panel>
</Tabs>

// Select
<Select selectedKey={value} onSelectionChange={(key) => setValue(key as string)}>
  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
  <Select.Popover>
    <ListBox items={items}>
      {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
    </ListBox>
  </Select.Popover>
</Select>

// Tooltip（复合组件，不是 content prop）
<Tooltip>
  <Tooltip.Trigger><Button>触发</Button></Tooltip.Trigger>
  <Tooltip.Content>提示文字</Tooltip.Content>
</Tooltip>

// Input with prefix icon（Input 没有 startContent prop）
<InputGroup>
  <InputGroup.Prefix><Search className="size-4" /></InputGroup.Prefix>
  <InputGroup.Input placeholder="搜索..." value={v} onChange={e => setV(e.target.value)} />
</InputGroup>

// EmptyState
<EmptyState>
  <EmptyState.Root>内容</EmptyState.Root>
</EmptyState>
```

### 已知 API 限制

| 组件 | 限制 |
|------|------|
| `Modal.Container` | `size` 只接受 `xs \| sm \| md \| lg \| full \| cover`，不支持 `xl` / `2xl` |
| `Input` | 无 `startContent` prop，无 `isDisabled`，用标准 HTML `disabled` |
| `Button` | 无 `isLoading` prop，用 `isDisabled` + 条件文字实现 |
| `Card` | 是普通 `div`，无 `onPress`，交互用 `onClick` |
| `Select.Value` | 无 `placeholder` prop，用 children：`<Select.Value>占位</Select.Value>` |
| `Switch` | `onChange` 接收 `boolean`（不是 event 对象） |
| `Tabs.Indicator` | **禁止使用**，会触发 SharedElement 运行时错误 |
| `Separator` | 分隔线组件名（v2 是 `Divider`） |

### Button variant 可用值

`primary | outline | ghost | secondary | tertiary | danger | danger-soft`

### Chip variant 可用值

`primary | secondary | tertiary | soft`

### Chip color 可用值

`default | primary | accent | success | warning | danger`

### Modal state 管理

```tsx
const modalState = useOverlayState({
  isOpen: showModal,
  onOpenChange: (v) => { if (!v) setShowModal(false); },
});
// 打开：setShowModal(true) 或 modalState.open()
// 关闭：setShowModal(false) 或 modalState.close()
```

## UI 设计规范

### 风格参考

参考 **Supabase Dashboard** 白色主题：
- 内容**左对齐**，不使用居中布局
- 列表页使用**表格行 + 分割线**样式（不是卡片网格）
- 页头简洁：`px-6 py-4 border-b border-border bg-background`
- 空状态左对齐展示（图标 + 标题 + 描述 + 操作按钮竖排）

### 语义化 Tailwind 颜色 token

| token | 用途 |
|-------|------|
| `bg-background` | 页面背景 |
| `bg-card` | 卡片背景 |
| `bg-muted` | 次级背景、代码块 |
| `bg-muted/30` | 悬停高亮 |
| `border-border` | 标准边框 |
| `text-foreground` | 主文字 |
| `text-muted-foreground` | 次级文字、标签 |
| `text-primary` | 主色 |
| `text-success` | 成功/绿色 |
| `text-warning` | 警告/黄色 |
| `text-danger` | 错误/红色 |
| `text-accent` | 强调色 |
| `bg-primary/10` | 主色淡背景 |
| `bg-success/5` | 成功淡背景 |
| `border-success/20` | 成功淡边框 |

### 列表页标准结构

```tsx
<div className="flex flex-col h-full">
  {/* 页头 */}
  <div className="px-6 py-4 border-b border-border bg-background shrink-0">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-semibold">页面标题</h1>
        <p className="text-sm text-muted-foreground mt-0.5">描述</p>
      </div>
      <Button size="sm">操作</Button>
    </div>
  </div>

  {/* 工具栏（可选） */}
  <div className="px-6 py-3 border-b border-border bg-background shrink-0 flex items-center gap-3">
    {/* 筛选器等 */}
  </div>

  {/* 内容区 */}
  <div className="flex-1 overflow-auto">
    {/* 表头行 */}
    <div className="flex items-center px-4 py-2 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground gap-4">
      列标题
    </div>
    {/* 数据行：border-b border-border hover:bg-muted/30 */}
  </div>
</div>
```

### 空状态标准结构（左对齐）

```tsx
<div className="flex flex-col items-start gap-3 px-6 py-20">
  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
    <Icon className="h-5 w-5 text-muted-foreground" />
  </div>
  <div>
    <h3 className="text-sm font-medium">标题</h3>
    <p className="text-sm text-muted-foreground mt-0.5">描述</p>
  </div>
  <Button size="sm" className="gap-1.5 mt-1">操作</Button>
</div>
```

## Next.js 16 特殊配置

### 中间件（proxy）

Next.js 16 将 middleware 重命名为 proxy：
- 文件名：`src/proxy.ts`（非 `src/middleware.ts`）
- 导出函数名：`export async function proxy()`（非 `middleware`）

### 动态页面

所有使用 Supabase 的 dashboard 页面必须加：

```ts
export const dynamic = 'force-dynamic';
```

否则构建时会尝试静态预渲染而报错。

### Vercel 超时配置

AI 分析接口在 `vercel.json` 中配置了 300s 超时：

```json
{ "functions": { "src/app/api/analyze/route": { "maxDuration": 300 } } }
```

## 目录结构

```
src/
  app/
    (auth)/               # 登录页（无 Sidebar）
      layout.tsx
      login/page.tsx
    (dashboard)/          # 受保护页面，含 Sidebar
      layout.tsx          # Sidebar + main 布局
      projects/           # 项目列表（ProjectsClient）
        [id]/             # 项目详情（CommitsClient + Tabs）
      reports/            # 报告列表（ReportsClient）
        [id]/             # 报告详情（ReportDetailClient / EnhancedReportDetailClient）
      rules/              # 规则集列表（RulesClient）
        [id]/             # 规则集详情（RuleSetDetailClient）
      settings/           # 连接状态页
    api/
      analyze/            # POST 触发 AI 分析（fire-and-forget）
      commits/            # GET GitHub commits
      projects/           # CRUD
      reports/            # GET 列表 + 详情
      rules/              # 规则集 CRUD
      stats/              # 统计数据
      github/             # GitHub 状态
    layout.tsx            # 根 layout，挂载 Providers（含 Toaster）
    globals.css           # @import "@heroui/styles"
    providers.tsx         # 客户端 Providers（Toaster）
  components/
    layout/Sidebar.tsx    # 侧边栏导航
    project/
      ProjectCard.tsx     # 项目行（表格行风格）
      AddProjectModal.tsx # 新增项目弹窗
      EditProjectModal.tsx# 编辑项目弹窗
      ProjectConfigPanel.tsx # 项目配置面板
    report/
      EnhancedIssueCard.tsx
      AIChat.tsx
      TrendChart.tsx
      ExportButton.tsx
      BatchOperations.tsx
      SavedFilters.tsx
    dashboard/
      DashboardStats.tsx  # 统计指标（简洁行内数字风格）
    common/
      VirtualScroll.tsx
  lib/
    utils.ts              # cn() 工具函数
    supabase/
      client.ts           # 浏览器端 Supabase client
      server.ts           # 服务端 + admin client
    offlineCache.ts
  services/
    db.ts                 # Supabase DB 操作
    github.ts             # Octokit 封装
    claude.ts             # Anthropic API（支持 ANTHROPIC_BASE_URL）
    logger.ts             # 结构化日志
    retry.ts              # 重试机制
    validation.ts         # Zod 验证
    sse.ts                # Server-Sent Events
    performance.ts        # 性能监控
    audit.ts              # 审计日志
    taskQueue.ts          # 任务队列
    incremental.ts        # 增量分析
    languages.ts          # 语言检测
  middleware/
    rateLimit.ts          # 速率限制
  proxy.ts                # 认证代理（Next.js 16 middleware 等价物）
```

## 环境变量

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GITHUB_PAT=              # Organization 级别 PAT
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=      # 可选，自定义 API 端点（代理）
```

## 常用命令

```bash
pnpm dev     # 开发服务器（端口 8109）
pnpm build   # 生产构建（TypeScript 检查 + 页面生成）
pnpm start   # 启动生产服务
pnpm lint    # 运行 ESLint
```

## AI 分析流程

1. 前端 POST `/api/analyze` → 立即返回 `{ reportId }`
2. 后端 fire-and-forget：获取 diff → Claude 分析 → 更新 report status
3. 前端轮询 `/api/reports/[id]`，每 2.5s 一次，直到 status 变为 `done` 或 `failed`

## Toast 使用

```ts
import { toast } from 'sonner';
toast.success('操作成功');
toast.error('操作失败');
toast.warning('警告信息');
```

`Toaster` 已在 `src/app/providers.tsx` 全局挂载。

## 常见问题

### Q: 构建时出现 TypeScript 错误怎么办？
A: 运行 `pnpm build`，逐一修复报错。常见问题：
- `Input` 用 `disabled` 而非 `isDisabled`
- `Card` 用 `onClick` 而非 `onPress`
- `Modal.Container size` 只能用 `xs|sm|md|lg|full|cover`

### Q: 如何添加带前缀图标的输入框？
A: `Input` 没有 `startContent`，使用 `InputGroup`：
```tsx
<InputGroup>
  <InputGroup.Prefix><Search className="size-4" /></InputGroup.Prefix>
  <InputGroup.Input placeholder="..." value={v} onChange={e => setV(e.target.value)} />
</InputGroup>
```

### Q: 如何实现进度条？
A: HeroUI v3 beta 无 Progress 组件，用 Tailwind 实现：
```tsx
<div className="h-1 rounded-full bg-muted overflow-hidden">
  <div className="h-full rounded-full bg-success" style={{ width: `${value}%` }} />
</div>
```

### Q: 为什么不用 Google Fonts？
A: Next.js 16 + Turbopack 存在已知问题，使用系统字体栈。

### Q: 深色模式支持吗？
A: 当前使用白色主题，在 `html` 标签添加 `dark` 类可切换深色，HeroUI v3 CSS 变量自动适配。
