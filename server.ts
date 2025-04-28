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
  retryCount?: number; // 添加重试计数器
}

// 重试配置
const MAX_RETRY_ATTEMPTS = 5; // 最大重试次数
const INITIAL_RETRY_DELAY = 1000; // 初始重试延迟（毫秒）

// 队列和重试间隔（毫秒）
const pendingTasks: WorkflowTask[] = [];
const waitingTasks: WorkflowTask[] = []; // 新增等待中的任务列表
let processingTaskCount = 0; // 替代 isProcessingPendingTask

// 全局SocketIO服务器变量，供其他函数访问
let ioServer: SocketIOServer;

// 计算指数退避延迟
function getRetryDelay(retryCount: number): number {
  return Math.min(INITIAL_RETRY_DELAY * Math.pow(2, retryCount), 30000); // 最大30秒
}

// 尝试提交等待中的任务
async function trySubmitWaitingTask() {
  if (waitingTasks.length === 0) return;
  
  const task = waitingTasks[0];
  
  // 初始化重试计数（如果不存在）
  if (task.retryCount === undefined) {
    task.retryCount = 0;
  }
  
  try {
    console.log(`尝试创建等待中的任务 (重试次数: ${task.retryCount}):`, task.createdAt);
    
    // 构建请求参数对象，仅当 nodeInfoList 存在且不为空时才包含
    const requestParams = {
      apiKey: task.apiKey,
      workflowId: task.workflowId,
      ...(task.nodeInfoList && task.nodeInfoList.length > 0 ? { nodeInfoList: task.nodeInfoList } : {})
    };
    
    const response = await axios.post('https://www.runninghub.cn/task/openapi/create', 
      requestParams, 
      {
        headers: {
          'Content-Type': 'application/json',
          'Host': 'www.runninghub.cn'
        },
        timeout: 10000
      }
    );
    
    console.log('等待队列中的工作流创建响应:', response.data);
    
    // 检查API返回的业务错误码
    if (response.data.code === 421 && response.data.msg === 'TASK_QUEUE_MAXED') {
      console.log('任务队列已满，任务继续等待');
      // 保持任务在队列中的位置不变
      // 但不增加processingTaskCount
      return;
    }
    
    // 成功创建
    if (response.data.code === 200 || response.data.code === 0) {
      // 从等待队列中移除
      waitingTasks.shift();
      
      // 通知客户端任务已成功创建，更新现有任务而不是创建新任务
      const socket = ioServer.sockets.sockets.get(task.socketId);
      if (socket) {
        // 添加 taskCompleted 事件发送
        if (response.data.data) {
          console.log('发送任务状态更新:', task.createdAt, response.data.data.taskId);
          socket.emit('workflowStatusUpdate', {
            originalCreatedAt: task.createdAt,
            taskId: response.data.data.taskId,
            status: response.data.data.taskStatus,
            createdAt: task.createdAt
          });
          
          // 关键：增加计数器，因为任务成功创建
          processingTaskCount++;
          console.log(`增加处理中任务计数: ${processingTaskCount}`);
        } else {
          socket.emit('workflowStatusUpdate', {
            originalCreatedAt: task.createdAt,
            taskId: null,
            status: 'SUCCESS',
            createdAt: task.createdAt
          });
        }
      }
    } else {
      console.log(`API返回错误码: ${response.data.code}, 消息: ${response.data.msg}`);
      
      // 任务创建失败，增加重试计数
      task.retryCount++;
      
      if (task.retryCount <= MAX_RETRY_ATTEMPTS) {
        const retryDelay = getRetryDelay(task.retryCount);
        console.error(`创建任务失败，将在${retryDelay}ms后重试, 第${task.retryCount}次重试`);
        
        // 延迟重试
        setTimeout(trySubmitWaitingTask, retryDelay);
      } else {
        console.error(`创建任务失败，已达到最大重试次数(${MAX_RETRY_ATTEMPTS})，放弃任务`);
        
        // 通知客户端任务失败
        const socket = ioServer.sockets.sockets.get(task.socketId);
        if (socket) {
          socket.emit('workflowStatusUpdate', {
            originalCreatedAt: task.createdAt,
            taskId: null,
            status: 'FAILED',
            createdAt: task.createdAt,
            error: '任务创建失败，请稍后重试'
          });
        }
        
        // 从等待队列中移除失败的任务
        waitingTasks.shift();
      }
    }
  } catch (error) {
    // 网络或其他错误，增加重试计数
    task.retryCount++;
    
    // 判断是否继续重试
    if (task.retryCount <= MAX_RETRY_ATTEMPTS) {
      const retryDelay = getRetryDelay(task.retryCount);
      console.error(`创建等待中的工作流时出错 (将在${retryDelay}ms后重试, 第${task.retryCount}次重试):`, error);
      
      // 延迟重试
      setTimeout(trySubmitWaitingTask, retryDelay);
    } else {
      console.error(`创建等待中的工作流失败，已达到最大重试次数(${MAX_RETRY_ATTEMPTS})，放弃任务:`, error);
      
      // 通知客户端任务失败
      const socket = ioServer.sockets.sockets.get(task.socketId);
      if (socket) {
        socket.emit('workflowStatusUpdate', {
          originalCreatedAt: task.createdAt,
          taskId: null,
          status: 'FAILED',
          createdAt: task.createdAt,
          error: '任务创建失败，请稍后重试'
        });
      }
      
      // 从等待队列中移除失败的任务
      waitingTasks.shift();
    }
  }
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
        const { apiKey, workflowId, nodeInfoList, _timestamp } = data;
        
        // 构建请求参数对象，仅当 nodeInfoList 存在且不为空时才包含
        const requestParams = {
          apiKey,
          workflowId,
          ...(nodeInfoList && nodeInfoList.length > 0 ? { nodeInfoList } : {})
        };
        
        // 调用RunningHub API创建工作流
        const response = await axios.post('https://www.runninghub.cn/task/openapi/create', 
          requestParams, 
          {
            headers: {
              'Content-Type': 'application/json',
              'Host': 'www.runninghub.cn'
            }
          }
        );
        
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
            createdAt: _timestamp || new Date().toISOString()
          };
          
          waitingTasks.push(task);
          
          // 通知客户端任务正在等待，确保状态为WAITING，并传递nodeInfoList
          socket.emit('workflowCreated', {
            taskId: null, // 确保taskId为null
            status: 'WAITING', // 使用字符串WAITING
            createdAt: task.createdAt,
            nodeInfoList: data.nodeInfoList // 添加nodeInfoList
          });
          
          // 如果当前没有正在处理的任务，尝试处理这个新的等待任务
          if (processingTaskCount === 0) {
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
            createdAt: _timestamp || new Date().toISOString()
          };
          
          waitingTasks.push(task);
          
          socket.emit('workflowCreated', {
            taskId: null,
            status: 'RETRY', // 自定义状态：稍后重试
            createdAt: task.createdAt,
            nodeInfoList: data.nodeInfoList // 添加nodeInfoList
          });
          return;
        }
        
        // 成功创建工作流
        // 确保response.data.data存在
        if (response.data.data) {
          socket.emit('workflowCreated', {
            taskId: response.data.data.taskId,
            status: response.data.data.taskStatus,
            createdAt: _timestamp || new Date().toISOString(),
            nodeInfoList: data.nodeInfoList // 添加nodeInfoList
          });
        } else {
          socket.emit('workflowCreated', {
            taskId: null,
            status: 'SUCCESS',
            createdAt: _timestamp || new Date().toISOString(),
            nodeInfoList: data.nodeInfoList // 添加nodeInfoList
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

    // 修改 taskCompleted 事件处理
    socket.on('taskCompleted', (data) => {
      console.log('收到任务完成通知:', data);
      
      // 减少正在处理的任务计数
      processingTaskCount--;
      if (processingTaskCount < 0) processingTaskCount = 0;
      
      // 重要：立即尝试处理等待队列中的任务
      if (waitingTasks.length > 0) {
        console.log('收到任务完成通知，立即尝试处理等待任务');
        // 直接调用，不使用 setTimeout
        trySubmitWaitingTask();
      }
    });

    // 处理删除任务请求
    socket.on('deleteTask', (data) => {
      const { uniqueId, taskId, createdAt, isWaiting } = data;
      console.log('收到删除任务请求:', data);
      
      // 如果是等待中的任务，根据createdAt从等待队列中删除
      if (isWaiting) {
        // 查找任务在等待队列中的索引
        const taskIndex = waitingTasks.findIndex(task => task.createdAt === createdAt);
        
        if (taskIndex !== -1) {
          // 从等待队列中移除任务
          waitingTasks.splice(taskIndex, 1);
          console.log(`已从等待队列中移除任务，队列剩余${waitingTasks.length}个任务`);
          
          // 通知客户端任务已被成功删除
          socket.emit('taskDeleted', { uniqueId, success: true });
        } else {
          console.log('未在等待队列中找到要删除的任务');
          socket.emit('taskDeleted', { uniqueId, success: false, error: '未找到任务' });
        }
      }
      // 非等待中的任务（有taskId）不需要特别处理，因为它们已经通过API取消
      else if (taskId) {
        socket.emit('taskDeleted', { taskId, success: true });
      }
    });
  });

  // 启动服务器
  httpServer.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

createServer(); 