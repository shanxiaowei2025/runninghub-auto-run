# RunningHub 工作流自动运行

这是一个基于 React + TypeScript + Vite 构建的 SSR (服务端渲染) 应用程序，用于自动运行 RunningHub 工作流。该应用程序允许用户创建工作流任务并实时监控其执行状态。

## 主要功能

- 创建 RunningHub 工作流任务
- 实时监控任务执行状态
- 自动接收工作流完成回调
- 支持多节点参数配置

## 技术栈

- **前端**：React 19 + TypeScript 5.7 + Tailwind CSS 4
- **构建工具**：Vite 6
- **服务端**：Express 5
- **实时通信**：Socket.IO 4
- **渲染模式**：SSR (服务端渲染)

## 项目结构

```
/
├── src/                    # 源代码目录
│   ├── components/         # React 组件
│   ├── services/           # 服务代码
│   ├── types/              # TypeScript 类型定义
│   ├── App.tsx             # 主应用组件
│   ├── entry-client.tsx    # 客户端入口
│   ├── entry-server.tsx    # 服务端入口
│   └── main.tsx            # 主入口文件
├── server.ts               # Express 服务器文件
├── index.html              # HTML 模板
├── vite.config.ts          # Vite 配置
└── tailwind.config.js      # Tailwind 配置
```

## 如何使用

### 开发环境

1. 安装依赖：
   ```
   npm install
   ```

2. 启动开发服务器：
   ```
   npm run dev
   ```

### 生产环境

1. 构建客户端和服务端代码：
   ```
   npm run build:client
   npm run build:server
   ```

2. 启动服务器：
   ```
   NODE_ENV=production node server
   ```

## 工作原理

1. 用户通过表单提交工作流参数
2. 服务器通过 API 请求创建 RunningHub 工作流，同时生成唯一的 webhook URL
3. 当工作流执行完成后，RunningHub 发送回调到 webhook URL
4. 服务器接收回调并通过 WebSocket 将结果实时推送给前端
5. 前端更新任务状态和结果展示

## WebSocket 事件

- `workflowCreated`: 工作流创建成功
- `workflowError`: 工作流创建失败
- `webhookCallback`: 接收到工作流完成回调

## API 路由

- `POST /api/webhook/:clientId`: 接收 RunningHub 的 webhook 回调

## 注意事项

- 确保前端 URL 在生产环境中正确配置为 `https://runninghub-auto-run.starlogic.tech/`
- Webhook URL 在开发环境设置为 `http://localhost:5173/api/webhook/:clientId`
- 工作流执行可能需要一些时间，结果将通过 WebSocket 实时更新

## 环境变量配置

项目使用不同的环境变量文件来配置开发和生产环境：

- `.env` - 默认环境变量
- `.env.development` - 开发环境变量（开发服务器启动时自动加载）
- `.env.production` - 生产环境变量（构建时自动加载）
- `.env.local` - 本地覆盖配置（优先级最高，不提交到仓库）

### HMR 配置变量

HMR（模块热替换）配置支持以下环境变量：

- `VITE_HMR_PROTOCOL` - HMR 连接协议 (ws/wss)
- `VITE_HMR_HOST` - HMR 服务器主机名
- `VITE_HMR_PORT` - HMR 服务器端口
- `VITE_HMR_CLIENT_PORT` - HMR 客户端端口（远程模式下使用）
- `VITE_HMR_PATH` - HMR WebSocket 路径（远程模式下使用）
- `VITE_REMOTE_MODE` - 是否启用远程模式 (true/false)

### 使用方法

1. 开发环境：`pnpm dev` (使用 .env.development)
2. 生产构建：`pnpm build` (使用 .env.production)
3. 自定义本地配置：创建 `.env.local` 文件（参考 `.env.local.example`）
