import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as httpCreateServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import axios from 'axios';
import type { Request, Response, NextFunction } from 'express';

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const isProduction = process.env.NODE_ENV === 'production';

// 创建服务器
async function createServer() {
  const app = express();
  const httpServer = httpCreateServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    }
  });

  app.use(cors({
    origin: '*',
    credentials: true
  }));
  app.use(express.json());

  // 如果是生产环境，则使用打包后的文件
  if (isProduction) {
    app.use(express.static(path.resolve(__dirname, 'dist/client')));
  } else {
    // 在开发环境中，使用Vite的开发服务器
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    // 处理根路径和单页应用所有路由
    app.get('/', handleSSR);
    app.get('/:path', handleSSR);
    
    // SSR处理函数
    async function handleSSR(req: Request, res: Response, next: NextFunction) {
      const url = req.originalUrl;

      try {
        // 1. 读取 index.html
        let template = fs.readFileSync(
          path.resolve(__dirname, '../index.html'),
          'utf-8'
        );

        // 2. 应用 Vite HTML 转换
        template = await vite.transformIndexHtml(url, template);

        // 3. 加载服务器入口
        const { render } = await vite.ssrLoadModule('/src/entry-server.tsx');

        // 4. 渲染应用的 HTML
        const appHtml = await render(url);

        // 5. 将渲染后的 HTML 注入到模板中
        const html = template.replace(`<!--ssr-outlet-->`, appHtml);

        // 6. 发送渲染后的 HTML
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    }
  }

  // WebSocket连接处理
  io.on('connection', (socket) => {
    console.log('客户端已连接', socket.id);

    // 创建工作流
    socket.on('createWorkflow', async (data) => {
      try {
        const { apiKey, workflowId, nodeInfoList } = data;
        
        // 调用RunningHub API创建工作流
        const response = await axios.post('https://www.runninghub.cn/task/openapi/create', {
          apiKey,
          workflowId,
          nodeInfoList
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Host': 'www.runninghub.cn'
          }
        });
        
        console.log('工作流创建响应:', response.data);
        
        // 将工作流信息和taskId发送回客户端
        socket.emit('workflowCreated', {
          taskId: response.data.data.taskId,
          status: response.data.data.taskStatus,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('创建工作流时出错:', error);
        socket.emit('workflowError', { error: '创建工作流时出错' });
      }
    });

    socket.on('disconnect', () => {
      console.log('客户端断开连接', socket.id);
    });
  });

  // 启动服务器
  httpServer.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

createServer(); 