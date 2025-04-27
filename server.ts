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

// 任务队列管理
interface WorkflowTask {
  socketId: string;
  apiKey: string;
  workflowId: string;
  nodeInfoList: Record<string, unknown>[];
  createdAt: string;
}

// 队列和重试间隔（毫秒）
const pendingTasks: WorkflowTask[] = [];
const waitingTasks: WorkflowTask[] = []; // 新增等待中的任务列表
let isProcessingPendingTask = false; // 标记是否有正在处理的PENDING任务

// 全局SocketIO服务器变量，供其他函数访问
let ioServer: SocketIOServer;

// 尝试提交等待中的任务
async function trySubmitWaitingTask() {
  if (waitingTasks.length === 0 || isProcessingPendingTask) return;
  
  isProcessingPendingTask = true;
  const task = waitingTasks[0];
  
  try {
    console.log('尝试创建等待中的任务:', task);
    const response = await axios.post('https://www.runninghub.cn/task/openapi/create', {
      apiKey: task.apiKey,
      workflowId: task.workflowId,
      nodeInfoList: task.nodeInfoList
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Host': 'www.runninghub.cn'
      }
    });
    
    console.log('等待队列中的工作流创建响应:', response.data);
    
    // 检查API返回的业务错误码
    if (response.data.code === 421 && response.data.msg === 'TASK_QUEUE_MAXED') {
      console.log('任务队列已满，任务继续等待');
      isProcessingPendingTask = false;
      return;
    }
    
    // 成功创建
    if (response.data.code === 200 || response.data.code === 0) {
      // 从等待队列中移除
      waitingTasks.shift();
      
      // 通知客户端任务已成功创建，更新现有任务而不是创建新任务
      const socket = ioServer.sockets.sockets.get(task.socketId);
      if (socket) {
        if (response.data.data) {
          console.log('发送任务状态更新:', task.createdAt, response.data.data.taskId);
          socket.emit('workflowStatusUpdate', {
            originalCreatedAt: task.createdAt, // 添加原始创建时间以便客户端可以找到对应任务
            taskId: response.data.data.taskId,
            status: response.data.data.taskStatus,
            createdAt: task.createdAt // 保持原有创建时间
          });
        } else {
          socket.emit('workflowStatusUpdate', {
            originalCreatedAt: task.createdAt,
            taskId: null,
            status: 'SUCCESS',
            createdAt: task.createdAt // 保持原有创建时间
          });
        }
      }
      
      // 此任务成功创建后，isProcessingPendingTask保持为true
      // 等待这个新创建的任务也完成后，客户端会通知服务器
    } else {
      console.log(`API返回错误码: ${response.data.code}, 消息: ${response.data.msg}`);
      // 任务创建失败，重置处理状态，继续等待
      isProcessingPendingTask = false;
    }
  } catch (error) {
    console.error('创建等待中的工作流时出错:', error);
    // 出错时也重置处理状态
    isProcessingPendingTask = false;
  }
}

// 任务完成（成功或失败）后的处理函数
function onTaskCompleted() {
  isProcessingPendingTask = false;
  // 尝试处理等待队列中的下一个任务
  setTimeout(trySubmitWaitingTask, 1000);
}

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
  
  // 设置全局io变量
  ioServer = io;

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
        
        // 检查是否是队列已满错误
        if (response.data.code === 421 && response.data.msg === 'TASK_QUEUE_MAXED') {
          console.log('任务队列已满，将任务加入等待队列');
          
          // 将任务添加到等待队列
          const task: WorkflowTask = {
            socketId: socket.id,
            apiKey: data.apiKey,
            workflowId: data.workflowId,
            nodeInfoList: data.nodeInfoList,
            createdAt: new Date().toISOString()
          };
          
          waitingTasks.push(task);
          
          // 通知客户端任务正在等待，确保状态为WAITING
          socket.emit('workflowCreated', {
            taskId: null, // 确保taskId为null
            status: 'WAITING', // 使用字符串WAITING
            createdAt: task.createdAt
          });
          
          // 如果当前没有正在处理的任务，尝试处理这个新的等待任务
          if (!isProcessingPendingTask) {
            setTimeout(trySubmitWaitingTask, 1000);
          }
          
          return;
        }
        
        // 检查响应的code字段，只有成功时(一般是code=200)才认为任务成功创建
        if (response.data.code !== 200 && response.data.code !== 0) {
          console.log(`API返回错误码: ${response.data.code}, 消息: ${response.data.msg}`);
          // 其他错误码也加入到队列中进行重试
          const task: WorkflowTask = {
            socketId: socket.id,
            apiKey: data.apiKey,
            workflowId: data.workflowId,
            nodeInfoList: data.nodeInfoList,
            createdAt: new Date().toISOString()
          };
          
          waitingTasks.push(task);
          
          socket.emit('workflowCreated', {
            taskId: null,
            status: 'RETRY', // 自定义状态：稍后重试
            createdAt: task.createdAt
          });
          return;
        }
        
        // 成功创建工作流
        // 确保response.data.data存在
        if (response.data.data) {
          socket.emit('workflowCreated', {
            taskId: response.data.data.taskId,
            status: response.data.data.taskStatus,
            createdAt: new Date().toISOString()
          });
        } else {
          socket.emit('workflowCreated', {
            taskId: null,
            status: 'SUCCESS',
            createdAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('创建工作流时出错:', error);
        
        // 网络错误或服务器异常，发送错误通知
        socket.emit('workflowError', { error: '创建工作流时出错' });
      }
    });

    socket.on('disconnect', () => {
      console.log('客户端断开连接', socket.id);
      // 从队列中移除该客户端的所有任务
      const index = pendingTasks.findIndex(task => task.socketId === socket.id);
      if (index !== -1) {
        pendingTasks.splice(index, 1);
      }
    });

    // 添加任务完成事件监听
    socket.on('taskCompleted', (data) => {
      console.log('收到任务完成通知:', data);
      
      // 标记没有正在处理的任务
      isProcessingPendingTask = false;
      
      // 尝试处理等待队列中的任务
      if (waitingTasks.length > 0) {
        console.log('有等待中的任务，尝试处理');
        setTimeout(trySubmitWaitingTask, 1000);
      }
    });
  });

  // 启动服务器
  httpServer.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

createServer(); 