import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as httpCreateServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const isProduction = process.env.NODE_ENV === 'production';
const FRONTEND_URL = 'https://runninghub-auto-run.starlogic.tech';

// Map to store webhook callback URLs and their clients
const webhookClients = new Map<string, string>();

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

  // API路由 - 将Webhook接收端点移到这里，确保在所有其他路由之前定义
  app.post('/api/webhook/:clientId', (req, res) => {
    const { clientId } = req.params;
    
    try {
      // 立即返回成功响应，避免超时
      res.status(200).json({ success: true });
      
      const socketId = webhookClients.get(clientId);
      console.log(`--------接收到来自客户端 ${clientId} 的webhook回调--------`);
      
      // 使用req.body而不是手动解析请求流
      const body = req.body;
      
      // 如果没有数据
      if (!body || Object.keys(body).length === 0) {
        console.error('Webhook请求体为空');
        return;
      }
      
      console.log('Webhook请求体:', JSON.stringify(body, null, 2));
      
      if (socketId) {
        // 提取webhook数据
        const { taskId, event, eventData } = body;
        
        if (!taskId || !event) {
          console.error('Webhook数据缺少必要字段:', body);
          return;
        }
        
        console.log(`webhook事件类型: ${event}, 任务ID: ${taskId}`);
        console.log(`webhook原始数据: ${typeof eventData === 'string' ? eventData : JSON.stringify(eventData)}`);
        
        // 尝试解析eventData
        let parsedEventData = eventData;
        if (typeof eventData === 'string') {
          try {
            parsedEventData = JSON.parse(eventData);
            console.log('解析后的webhook数据:', JSON.stringify(parsedEventData, null, 2));
          } catch (error) {
            console.error('解析webhook数据时出错:', error);
          }
        }
        
        // 通过WebSocket向客户端发送webhook回调数据
        io.to(socketId).emit('webhookCallback', {
          taskId,
          event,
          data: eventData,
          receivedAt: new Date().toISOString()
        });
        console.log(`已将webhook数据发送给socket ${socketId}`);
      } else {
        console.log(`未找到客户端 ${clientId} 的socket连接`);
      }
    } catch (error) {
      console.error('处理webhook回调时出错:', error);
    }
  });

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

    // 添加socket ID到客户端映射中
    socket.on('register', (clientId) => {
      webhookClients.set(clientId, socket.id);
      console.log(`客户端 ${clientId} 已注册，Socket ID: ${socket.id}`);
    });

    // 创建工作流
    socket.on('createWorkflow', async (data) => {
      try {
        const { apiKey, workflowId, nodeInfoList } = data;
        const clientId = uuidv4();
        
        // 存储客户端ID和socket ID的映射关系
        webhookClients.set(clientId, socket.id);
        
        // 构建webhook URL
        const webhookUrl = `${FRONTEND_URL}/api/webhook/${clientId}`;
        
        console.log(`为客户端 ${clientId} 创建的webhook URL: ${webhookUrl}`);
        
        // 调用RunningHub API创建工作流
        const response = await axios.post('https://www.runninghub.cn/task/openapi/create', {
          apiKey,
          workflowId,
          nodeInfoList,
          webhookUrl
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
          clientId,
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
      
      // 从映射中删除断开连接的客户端
      for (const [clientId, socketId] of webhookClients.entries()) {
        if (socketId === socket.id) {
          webhookClients.delete(clientId);
          console.log(`客户端 ${clientId} 已从映射中删除`);
        }
      }
    });
  });

  // 启动服务器
  httpServer.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

createServer(); 