import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as httpCreateServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import axios from 'axios';
import type { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const isProduction = process.env.NODE_ENV === 'production';

// 初始化SQLite数据库
const dbPath = path.resolve(__dirname, 'tasks.db');
console.log('使用数据库路径:', dbPath);
const db = new Database(dbPath);

// 检查数据库文件是否可读写
try {
  // 执行一个简单的查询确认数据库连接有效
  const result = db.prepare('SELECT 1').get();
  console.log('数据库连接正常:', result);
} catch (error) {
  console.error('数据库连接错误:', error);
}

// 创建任务表
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taskId TEXT,
    clientId TEXT NOT NULL,
    status TEXT NOT NULL,
    result TEXT,
    createdAt TEXT NOT NULL,
    completedAt TEXT,
    error TEXT,
    nodeInfoList TEXT,
    socketId TEXT,
    uniqueId TEXT
  )
`);

// 检查并修复数据库表结构
function checkAndFixDatabaseSchema() {
  try {
    console.log('检查数据库表结构...');

    // 检查tasks表是否存在
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    
    if (!tableExists) {
      console.log('创建tasks表...');
      // 创建任务表
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          taskId TEXT,
          clientId TEXT NOT NULL,
          status TEXT NOT NULL,
          result TEXT,
          createdAt TEXT NOT NULL,
          completedAt TEXT,
          error TEXT,
          nodeInfoList TEXT,
          socketId TEXT,
          uniqueId TEXT
        )
      `);
      console.log('tasks表创建成功');
      return;
    }
    
    // 表存在，检查列是否完整
    const columns = db.prepare("PRAGMA table_info(tasks)").all();
    const columnNames = columns.map((col: unknown) => {
      const typedCol = col as { name: string };
      return typedCol.name;
    });
    
    // 打印表结构信息
    console.log('当前数据库表结构:', columnNames);
    
    // 所有应该存在的列
    const expectedColumns = [
      {name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      {name: 'taskId', type: 'TEXT'},
      {name: 'clientId', type: 'TEXT NOT NULL'},
      {name: 'status', type: 'TEXT NOT NULL'},
      {name: 'result', type: 'TEXT'},
      {name: 'createdAt', type: 'TEXT NOT NULL'},
      {name: 'completedAt', type: 'TEXT'},
      {name: 'error', type: 'TEXT'},
      {name: 'nodeInfoList', type: 'TEXT'},
      {name: 'socketId', type: 'TEXT'},
      {name: 'uniqueId', type: 'TEXT'}
    ];
    
    // 检查列名的别名情况（如clientId和client_id）
    const columnMapping: Record<string, string> = {};
    for (const col of columnNames) {
      // 将snake_case转换为camelCase
      const camelCase = col.replace(/_([a-z])/g, (g: string) => g[1].toUpperCase());
      if (camelCase !== col) {
        console.log(`发现列名映射: ${col} -> ${camelCase}`);
        columnMapping[camelCase] = col;
      }
    }
    
    // 检查是否有缺失的列
    const missingColumns = expectedColumns.filter(col => {
      // 检查原始名称和可能的snake_case名称
      const snakeCase = col.name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      return !columnNames.includes(col.name) && !columnNames.includes(snakeCase);
    });
    
    if (missingColumns.length > 0) {
      console.log(`发现缺失的列: ${missingColumns.map(c => c.name).join(', ')}`);
      
      // 添加缺失的列
      missingColumns.forEach(col => {
        try {
          if (col.name !== 'id') { // 主键列不能后添加
            db.exec(`ALTER TABLE tasks ADD COLUMN ${col.name} ${col.type.replace('NOT NULL', '')}`);
            console.log(`添加列 ${col.name} 成功`);
          }
        } catch (err) {
          console.error(`添加列 ${col.name} 失败:`, err);
        }
      });
    } else {
      console.log('数据库表结构完整');
    }
    
    // 记录列名映射，供后续使用
    global.columnMapping = columnMapping;
    
  } catch (error) {
    console.error('检查数据库表结构时出错:', error);
  }
}

// 定义全局变量用于存储列名映射
declare global {
  // eslint-disable-next-line no-var
  var columnMapping: Record<string, string>;
}

// 设置初始的列名映射
global.columnMapping = {};

// 在服务器启动时检查数据库结构
checkAndFixDatabaseSchema();

// 定义任务类型(Interface)
interface Task {
  taskId: string | null;
  clientId: string;
  status: string;
  createdAt: string;
  uniqueId: string;
  result: unknown;
  nodeInfoList?: unknown[];
  [key: string]: unknown;  // 添加索引签名以允许动态属性
}

// 任务队列管理
interface WorkflowTask {
  socketId: string;
  apiKey: string;
  workflowId: string;
  nodeInfoList: Record<string, unknown>[];
  createdAt: string;
  uniqueId: string;
  retryCount?: number; // 添加重试计数器
  clientId?: string; // 添加客户端ID
  pendingProcess?: boolean; // 添加等待处理标记
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

// 添加检查列是否存在的辅助函数
function checkColumnExists(tableName: string, columnName: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{name: string}>;
    return columns.some(col => col.name === columnName);
  } catch (error) {
    console.error(`Error checking if column ${columnName} exists in ${tableName}:`, error);
    return false;
  }
}

// 生成UUID函数
function generateUUID(): string {
  return crypto.randomUUID();
}

// 保存任务到数据库
function saveTaskToDb(task: Record<string, unknown>): number {
  try {
    // 输出任务信息用于调试
    console.log('保存任务到数据库:', JSON.stringify(task, null, 2));
    
    // 验证clientId是否存在
    if (!task.clientId) {
      console.error('任务缺少clientId，拒绝保存到数据库');
      return -1;
    }
    
    // 如果没有uniqueId，生成一个
    if (!task.uniqueId) {
      task.uniqueId = generateUUID();
      console.log('为任务生成uniqueId:', task.uniqueId);
    }
    
    // 准备数据 - 将对象转换为JSON字符串
    const nodeInfoListJson = task.nodeInfoList ? JSON.stringify(task.nodeInfoList) : null;
    const resultJson = task.result ? JSON.stringify(task.result) : null;
    
    // 获取列名映射
    const columnMap = global.columnMapping || {};
    console.log('列名映射:', columnMap);
    
    // 检查任务表结构
    const tableColumns = db.prepare("PRAGMA table_info(tasks)").all();
    const columnNames = tableColumns.map((col: unknown) => {
      const typedCol = col as { name: string };
      return typedCol.name;
    });
    console.log('实际的列名:', columnNames);
    
    // 确定表中实际使用的列名格式（蛇形或驼峰）
    const usesSnakeCase = columnNames.some(name => name.includes('_'));
    console.log('表使用蛇形命名法:', usesSnakeCase);
    
    // 根据表中列名的实际格式选择对应的列名
    const getColumnName = (camelName: string): string => {
      // 先检查映射
      if (columnMap[camelName]) {
        return columnMap[camelName];
      }
      
      // 再检查表中是否直接存在驼峰命名的列
      if (columnNames.includes(camelName)) {
        return camelName;
      }
      
      // 最后尝试转换为蛇形命名查找
      const snakeName = camelName.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (columnNames.includes(snakeName)) {
        return snakeName;
      }
      
      // 默认返回原始名称
      return camelName;
    };
    
    // 获取正确的列名
    const clientIdCol = getColumnName('clientId');
    const taskIdCol = getColumnName('taskId');
    const statusCol = getColumnName('status');
    const resultCol = getColumnName('result');
    const createdAtCol = getColumnName('createdAt');
    const completedAtCol = getColumnName('completedAt');
    const errorCol = getColumnName('error');
    const nodeInfoListCol = getColumnName('nodeInfoList');
    const socketIdCol = getColumnName('socketId');
    const uniqueIdCol = getColumnName('uniqueId');
    
    // 打印字段名称（调试用）
    console.log(`使用的字段名: clientId=${clientIdCol}, taskId=${taskIdCol}, createdAt=${createdAtCol}, uniqueId=${uniqueIdCol}`);
    
    // 构建动态SQL语句
    const columnsList = [
      taskIdCol, 
      clientIdCol, 
      statusCol, 
      resultCol, 
      createdAtCol, 
      completedAtCol, 
      errorCol, 
      nodeInfoListCol, 
      socketIdCol,
      uniqueIdCol
    ].join(', ');
    
    const placeholders = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
    
    const sql = `
      INSERT INTO tasks (
        ${columnsList}
      ) VALUES (${placeholders})
    `;
    
    console.log('SQL语句:', sql);
    
    const stmt = db.prepare(sql);
    
    // 使用task中提供的clientId，不替换为default
    const clientIdValue = task.clientId;
    console.log('使用客户端ID:', clientIdValue);
    
    const info = stmt.run(
      task.taskId || null,
      clientIdValue,
      task.status,
      resultJson,
      task.createdAt,
      task.completedAt || null,
      task.error || null,
      nodeInfoListJson,
      task.socketId || null,
      task.uniqueId
    );
    
    console.log(`任务已保存到数据库，ID: ${info.lastInsertRowid}`);
    return Number(info.lastInsertRowid);
  } catch (error) {
    console.error('保存任务到数据库时出错:', error);
    
    // 尝试使用简化版本的语句，同样确保使用正确的clientId
    try {
      console.log('尝试使用简化的SQL插入...');
      const basicStmt = db.prepare(`
        INSERT INTO tasks (
          clientId, status, createdAt, uniqueId
        ) VALUES (?, ?, ?, ?)
      `);
      
      // 使用传入的clientId，不使用default
      const info = basicStmt.run(
        task.clientId,
        task.status,
        task.createdAt,
        task.uniqueId || generateUUID()
      );
      
      console.log(`使用简化版本保存任务成功，ID: ${info.lastInsertRowid}`);
      return Number(info.lastInsertRowid);
    } catch (fallbackError) {
      console.error('简化版本也保存失败:', fallbackError);
      
      // 最终回退：尝试查找实际的列名
      try {
        const columns = db.prepare("PRAGMA table_info(tasks)").all();
        const columnNames = columns.map((col: unknown) => {
          const typedCol = col as { name: string };
          return typedCol.name;
        });
        console.log('实际的列名:', columnNames);
        
        // 查找client_id或类似形式的列名
        const clientIdColumn = columnNames.find(name => 
          name === 'clientId' || name === 'client_id' || name.toLowerCase().includes('client')
        );
        
        const uniqueIdExists = columnNames.includes('uniqueId') || columnNames.includes('unique_id');
        
        if (clientIdColumn) {
          console.log(`找到clientId对应的列名: ${clientIdColumn}`);
          const lastStmt = uniqueIdExists 
            ? db.prepare(`
                INSERT INTO tasks (
                  ${clientIdColumn}, status, createdAt, uniqueId
                ) VALUES (?, ?, ?, ?)
              `)
            : db.prepare(`
                INSERT INTO tasks (
                  ${clientIdColumn}, status, createdAt
                ) VALUES (?, ?, ?)
              `);
          
          // 使用传入的clientId，不使用default
          const uniqueId = task.uniqueId || generateUUID();
          const info = uniqueIdExists
            ? lastStmt.run(
                task.clientId,
                task.status,
                task.createdAt,
                uniqueId
              )
            : lastStmt.run(
                task.clientId,
                task.status,
                task.createdAt
              );
          
          console.log(`使用真实列名保存任务成功，ID: ${info.lastInsertRowid}`);
          return Number(info.lastInsertRowid);
        }
      } catch (finalError) {
        console.error('所有尝试都失败了:', finalError);
      }
    }
    
    return -1;
  }
}

// 更新任务状态
export function updateTaskStatus(taskId: string, status: string, completedAt?: string, result?: unknown, error?: string): boolean {
  try {
    let stmt;
    let params;
    
    if (result) {
      const resultJson = JSON.stringify(result);
      stmt = db.prepare(`
        UPDATE tasks 
        SET status = ?, completedAt = ?, result = ?
        WHERE taskId = ?
      `);
      params = [status, completedAt || new Date().toISOString(), resultJson, taskId];
    } else if (error) {
      stmt = db.prepare(`
        UPDATE tasks 
        SET status = ?, completedAt = ?, error = ?
        WHERE taskId = ?
      `);
      params = [status, completedAt || new Date().toISOString(), error, taskId];
    } else {
      stmt = db.prepare(`
        UPDATE tasks 
        SET status = ?, completedAt = ?
        WHERE taskId = ?
      `);
      params = [status, completedAt, taskId];
    }
    
    const info = stmt.run(...params);
    return info.changes > 0;
  } catch (error) {
    console.error('更新任务状态时出错:', error);
    return false;
  }
}

// 通过 uniqueId 更新任务状态
export function updateTaskStatusByUniqueId(uniqueId: string, status: string, completedAt?: string, result?: unknown, error?: string): boolean {
  try {
    let stmt;
    let params;
    
    if (result) {
      const resultJson = JSON.stringify(result);
      stmt = db.prepare(`
        UPDATE tasks 
        SET status = ?, completedAt = ?, result = ?
        WHERE uniqueId = ?
      `);
      params = [status, completedAt || new Date().toISOString(), resultJson, uniqueId];
    } else if (error) {
      stmt = db.prepare(`
        UPDATE tasks 
        SET status = ?, completedAt = ?, error = ?
        WHERE uniqueId = ?
      `);
      params = [status, completedAt || new Date().toISOString(), error, uniqueId];
    } else {
      stmt = db.prepare(`
        UPDATE tasks 
        SET status = ?, completedAt = ?
        WHERE uniqueId = ?
      `);
      params = [status, completedAt, uniqueId];
    }
    
    const info = stmt.run(...params);
    return info.changes > 0;
  } catch (error) {
    console.error('通过uniqueId更新任务状态时出错:', error);
    return false;
  }
}

// 删除任务
export function deleteTask(taskId?: string, createdAt?: string, uniqueId?: string): boolean {
  try {
    let stmt;
    let params;
    
    if (uniqueId) {
      stmt = db.prepare('DELETE FROM tasks WHERE uniqueId = ?');
      params = [uniqueId];
    } else if (taskId) {
      stmt = db.prepare('DELETE FROM tasks WHERE taskId = ?');
      params = [taskId];
    } else if (createdAt) {
      stmt = db.prepare('DELETE FROM tasks WHERE createdAt = ?');
      params = [createdAt];
    } else {
      return false;
    }
    
    const info = stmt.run(...params);
    return info.changes > 0;
  } catch (error) {
    console.error('删除任务时出错:', error);
    return false;
  }
}

// 获取客户端的所有任务
function getClientTasks(clientId: string): Task[] {
  try {
    const columnMap = global.columnMapping || {};
    const tasksStmt = db.prepare(`
      SELECT 
        ${columnMap.id || 'id'}, 
        ${columnMap.taskId || 'taskId'}, 
        ${columnMap.clientId || 'clientId'}, 
        ${columnMap.status || 'status'}, 
        ${columnMap.result || 'result'}, 
        ${columnMap.createdAt || 'createdAt'}, 
        ${columnMap.completedAt || 'completedAt'}, 
        ${columnMap.error || 'error'},
        ${columnMap.nodeInfoList || 'nodeInfoList'},
        ${columnMap.uniqueId || 'uniqueId'}
      FROM tasks 
      WHERE ${columnMap.clientId || 'clientId'} = ?
      ORDER BY ${columnMap.createdAt || 'createdAt'} DESC
    `);
    
    const tasks = tasksStmt.all(clientId) as Record<string, unknown>[];
    
    // 将结果转换为任务对象数组
    const result = tasks.map(task => {
      // 确保每个任务都有 uniqueId，如果没有就生成一个
      const uniqueId = task[columnMap.uniqueId || 'uniqueId'] as string || generateUUID();
      
      const taskObj: Task = {
        taskId: task[columnMap.taskId || 'taskId'] as string,
        clientId: task[columnMap.clientId || 'clientId'] as string,
        status: task[columnMap.status || 'status'] as string,
        createdAt: task[columnMap.createdAt || 'createdAt'] as string,
        uniqueId: uniqueId,
        result: null
      };
      
      // 处理JSON解析
      if (task[columnMap.result || 'result']) {
        try {
          taskObj.result = JSON.parse(task[columnMap.result || 'result'] as string);
        } catch {
          taskObj.result = task[columnMap.result || 'result'];
        }
      }
      
      // 添加完成时间（如果存在）
      if (task[columnMap.completedAt || 'completedAt']) {
        taskObj.completedAt = task[columnMap.completedAt || 'completedAt'] as string;
      }
      
      // 添加错误信息（如果存在）
      if (task[columnMap.error || 'error']) {
        taskObj.error = task[columnMap.error || 'error'] as string;
      }
      
      // 添加nodeInfoList（如果存在）
      if (task[columnMap.nodeInfoList || 'nodeInfoList']) {
        try {
          taskObj.nodeInfoList = JSON.parse(task[columnMap.nodeInfoList || 'nodeInfoList'] as string);
        } catch {
          // 解析失败则忽略
        }
      }
      
      return taskObj;
    });
    
    // 找出并恢复WAITING状态的任务（重新添加到等待队列）
    result.forEach(task => {
      if ((task.status === 'WAITING' || task.status === 'QUEUED') && task.nodeInfoList) {
        console.log(`找到客户端 ${clientId} 的等待中任务，重新加入等待队列`);
        
        // 从数据库获取apiKey和workflowId
        const taskDetails = db.prepare(`
          SELECT * FROM tasks
          WHERE ${columnMap.uniqueId || 'uniqueId'} = ?
        `).get(task.uniqueId) as Record<string, unknown>;
        
        if (taskDetails) {
          // 检查我们是否已经有一个相同uniqueId的任务在等待队列中
          const existingTask = waitingTasks.find(t => t.uniqueId === task.uniqueId);
          if (existingTask) {
            console.log('任务已在等待队列中，不重复添加');
            return;
          }
          
          // 从task.nodeInfoList中提取apiKey和workflowId
          const nodeInfo = task.nodeInfoList as Array<Record<string, unknown>>;
          let apiKey = '';
          let workflowId = '';
          
          // 尝试从nodeInfoList中提取信息
          if (nodeInfo && nodeInfo.length > 0) {
            const firstNode = nodeInfo[0];
            if (firstNode.fieldName === 'apiKey' && typeof firstNode.fieldValue === 'string') {
              apiKey = firstNode.fieldValue;
            }
            
            // 尝试找到workflowId
            const workflowNode = nodeInfo.find(node => 
              node.fieldName === 'workflowId' && typeof node.fieldValue === 'string'
            );
            
            if (workflowNode && typeof workflowNode.fieldValue === 'string') {
              workflowId = workflowNode.fieldValue;
            }
          }
          
          // 如果获取不到必要信息，从数据库任务记录中的字符串解析
          if (!apiKey || !workflowId) {
            try {
              // 显式提取节点信息，避免直接使用taskDetails索引
              const nodeInfoKey = columnMap.nodeInfoList || 'nodeInfoList';
              const nodeInfoValue = taskDetails ? taskDetails[nodeInfoKey] : null;
              const nodeInfoString = nodeInfoValue as string;
              
              if (nodeInfoString) {
                const parsedNodeInfo = JSON.parse(nodeInfoString) as Array<Record<string, unknown>>;
                
                // 尝试提取apiKey和workflowId
                for (const node of parsedNodeInfo) {
                  if (node.fieldName === 'apiKey' && typeof node.fieldValue === 'string') {
                    apiKey = node.fieldValue;
                  } else if (node.fieldName === 'workflowId' && typeof node.fieldValue === 'string') {
                    workflowId = node.fieldValue;
                  }
                }
              }
            } catch (error) {
              console.error('解析nodeInfoList时出错:', error);
            }
          }
          
          // 只有当我们有了必要的信息才重新添加任务
          if (apiKey && workflowId && task.nodeInfoList) {
            // 创建新的等待任务并添加到队列
            const waitingTask: WorkflowTask = {
              socketId: '',  // 新连接无法恢复旧的socketId
              apiKey,
              workflowId,
              nodeInfoList: task.nodeInfoList as Record<string, unknown>[],
              createdAt: task.createdAt,
              uniqueId: task.uniqueId,
              clientId: task.clientId
            };
            
            // 检查是否已经在队列中
            const isInWaitingQueue = waitingTasks.some(t => t.uniqueId === waitingTask.uniqueId);
            const isInPendingQueue = pendingTasks.some(t => t.uniqueId === waitingTask.uniqueId);
            
            if (!isInWaitingQueue && !isInPendingQueue) {
              console.log(`将任务重新添加到等待队列: ${task.uniqueId}`);
              waitingTasks.push(waitingTask);
              
              // 尝试处理等待队列中的任务
              if (waitingTasks.length > 0 && processingTaskCount < 3) {
                setTimeout(trySubmitWaitingTask, 1000);
                
                // 设置一个标记，表示此任务已被加入队列等待处理
                task.pendingProcess = true;
                
                // 向与此clientId关联的所有socket广播通知，告知任务已被重新加入队列
                // 找到所有当前连接的socket
                const connectedSockets = Array.from(ioServer.sockets.sockets.values());
                
                // 广播任务更新状态通知（仅在没有指定socketId时）
                if (!waitingTask.socketId && connectedSockets.length > 0) {
                  console.log(`广播任务状态更新通知 (clientId: ${clientId}, uniqueId: ${task.uniqueId})`);
                  
                  // 广播给所有客户端，客户端会根据clientId和uniqueId过滤
                  ioServer.emit('taskRecoveryUpdate', {
                    clientId,
                    createdAt: task.createdAt,
                    originalCreatedAt: task.createdAt,
                    uniqueId: task.uniqueId,
                    taskId: null,
                    status: 'WAITING', // 保持为WAITING状态，直到真正被处理
                    message: '任务已重新加入处理队列'
                  });
                }
              }
            }
          } else {
            console.log('无法恢复等待任务，缺少必要信息');
          }
        }
      }
    });
    
    return result;
  } catch (error) {
    console.error('获取客户端任务失败:', error);
    return [];
  }
}

// 尝试提交等待中的任务
async function trySubmitWaitingTask() {
  if (waitingTasks.length === 0) return;
  
  const task = waitingTasks[0];
  
  // 初始化重试计数（如果不存在）
  if (task.retryCount === undefined) {
    task.retryCount = 0;
  }
  
  // 确保任务有 uniqueId
  if (!task.uniqueId) {
    task.uniqueId = generateUUID();
    console.log('为等待中的任务生成 uniqueId:', task.uniqueId);
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
      const socket = task.socketId ? ioServer.sockets.sockets.get(task.socketId) : null;
      
      // 首先更新数据库中的任务状态
      if (response.data.data) {
        console.log('更新任务状态:', task.createdAt, response.data.data.taskId);
        
        const updateData = {
          originalCreatedAt: task.createdAt,
          taskId: response.data.data.taskId,
          status: response.data.data.taskStatus,
          createdAt: task.createdAt,
          uniqueId: task.uniqueId
        };
        
        // 更新数据库中的任务
        // 先基于uniqueId查找任务，然后更新taskId和status
        const columnMap = global.columnMapping || {};
        
        // 确保使用正确的列名
        let clientIdCol = columnMap.clientId || 'clientId';
        if (clientIdCol === 'clientId' && checkColumnExists('tasks', 'client_id')) {
          clientIdCol = 'client_id';
        }
        
        let createdAtCol = columnMap.createdAt || 'createdAt';
        if (createdAtCol === 'createdAt' && checkColumnExists('tasks', 'created_at')) {
          createdAtCol = 'created_at';
        }
        
        let taskIdCol = columnMap.taskId || 'taskId';
        if (taskIdCol === 'taskId' && checkColumnExists('tasks', 'task_id')) {
          taskIdCol = 'task_id';
        }
        
        let uniqueIdCol = columnMap.uniqueId || 'uniqueId';
        if (uniqueIdCol === 'uniqueId' && checkColumnExists('tasks', 'unique_id')) {
          uniqueIdCol = 'unique_id';
        }
        
        const statusCol = columnMap.status || 'status';
        
        // 确保任务的clientId不为空
        const clientIdValue = task.clientId;
        if (!clientIdValue) {
          console.error('任务的clientId为空，无法更新');
          return;
        }
        
        // 优先使用 uniqueId 更新
        const updateStmt = db.prepare(`
          UPDATE tasks 
          SET ${taskIdCol} = ?, ${statusCol} = ? 
          WHERE ${uniqueIdCol} = ?
        `);
        
        try {
          updateStmt.run(
            response.data.data.taskId,
            response.data.data.taskStatus,
            task.uniqueId
          );
          console.log(`任务状态已通过 uniqueId 更新 [${task.uniqueId}]:`, response.data.data.taskStatus);
          
          // 如果有socket连接，通知客户端
          if (socket) {
            socket.emit('workflowStatusUpdate', updateData);
          } else {
            console.log('没有活跃的socket连接，广播更新通知');
            
            // 广播给所有客户端，处理恢复的任务状态更新
            ioServer.emit('workflowStatusUpdate', {
              ...updateData,
              clientId: clientIdValue, // 添加clientId以便前端可以过滤
              recovered: true // 标记为恢复的任务
            });
          }
          
          // 关键：增加计数器，因为任务成功创建
          processingTaskCount++;
          console.log(`增加处理中任务计数: ${processingTaskCount}`);
        } catch (updateError) {
          console.error('更新任务状态失败:', updateError);
          
          // 尝试使用 createdAt 作为备选
          try {
            const fallbackUpdateStmt = db.prepare(`
              UPDATE tasks 
              SET ${taskIdCol} = ?, ${statusCol} = ? 
              WHERE ${createdAtCol} = ? AND ${clientIdCol} = ?
            `);
            
            fallbackUpdateStmt.run(
              response.data.data.taskId,
              response.data.data.taskStatus,
              task.createdAt,
              clientIdValue
            );
            console.log(`备选方案：任务状态已通过 createdAt 更新 [${clientIdValue}]:`, response.data.data.taskStatus);
            
            // 如果有socket连接，通知客户端
            if (socket) {
              socket.emit('workflowStatusUpdate', updateData);
            } else {
              // 广播给所有客户端
              ioServer.emit('workflowStatusUpdate', {
                ...updateData,
                clientId: clientIdValue,
                recovered: true
              });
            }
            
            // 增加计数器
            processingTaskCount++;
            console.log(`增加处理中任务计数: ${processingTaskCount}`);
          } catch (fallbackError) {
            console.error('备选方案也失败了:', fallbackError);
          }
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
        
        // 从等待队列中移除失败的任务
        waitingTasks.shift();
        
        // 通知客户端任务失败
        const socket = task.socketId ? ioServer.sockets.sockets.get(task.socketId) : null;
        const updateData = {
          originalCreatedAt: task.createdAt,
          taskId: null,
          status: 'FAILED',
          createdAt: task.createdAt,
          error: '任务创建失败，请稍后重试'
        };
        
        // 更新数据库中的任务
        const columnMap = global.columnMapping || {};
        
        // 确保使用正确的列名
        let clientIdCol = columnMap.clientId || 'clientId';
        if (clientIdCol === 'clientId' && checkColumnExists('tasks', 'client_id')) {
          clientIdCol = 'client_id';
        }
        
        let createdAtCol = columnMap.createdAt || 'createdAt';
        if (createdAtCol === 'createdAt' && checkColumnExists('tasks', 'created_at')) {
          createdAtCol = 'created_at';
        }
        
        const statusCol = columnMap.status || 'status';
        let errorCol = columnMap.error || 'error';
        if (errorCol === 'error' && checkColumnExists('tasks', 'error_msg')) {
          errorCol = 'error_msg';
        }
        
        let completedAtCol = columnMap.completedAt || 'completedAt';
        if (completedAtCol === 'completedAt' && checkColumnExists('tasks', 'completed_at')) {
          completedAtCol = 'completed_at';
        }
        
        // 确保任务的clientId不为空
        const clientIdValue = task.clientId;
        if (!clientIdValue) {
          console.error('任务的clientId为空，无法更新');
          return;
        }
        
        const updateStmt = db.prepare(`
          UPDATE tasks 
          SET ${statusCol} = ?, ${errorCol} = ?, ${completedAtCol} = ? 
          WHERE ${createdAtCol} = ? AND ${clientIdCol} = ?
        `);
        
        try {
          updateStmt.run(
            'FAILED',
            '任务创建失败，请稍后重试',
            new Date().toISOString(),
            task.createdAt,
            clientIdValue
          );
          console.log(`任务已标记为失败 [${clientIdValue}]`);
          
          // 如果有socket连接，通知客户端
          if (socket) {
            socket.emit('workflowStatusUpdate', updateData);
          } else {
            console.log('没有活跃的socket连接，跳过客户端通知');
          }
        } catch (updateError) {
          console.error('更新任务状态失败:', updateError);
        }
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
      
      // 从等待队列中移除失败的任务
      waitingTasks.shift();
      
      // 通知客户端任务失败
      const socket = task.socketId ? ioServer.sockets.sockets.get(task.socketId) : null;
      const updateData = {
        originalCreatedAt: task.createdAt,
        taskId: null,
        status: 'FAILED',
        createdAt: task.createdAt,
        error: '任务创建失败，请稍后重试'
      };
      
      // 更新数据库中的任务
      const columnMap = global.columnMapping || {};
      
      // 确保使用正确的列名
      let clientIdCol = columnMap.clientId || 'clientId';
      if (clientIdCol === 'clientId' && checkColumnExists('tasks', 'client_id')) {
        clientIdCol = 'client_id';
      }
      
      let createdAtCol = columnMap.createdAt || 'createdAt';
      if (createdAtCol === 'createdAt' && checkColumnExists('tasks', 'created_at')) {
        createdAtCol = 'created_at';
      }
      
      const statusCol = columnMap.status || 'status';
      let errorCol = columnMap.error || 'error';
      if (errorCol === 'error' && checkColumnExists('tasks', 'error_msg')) {
        errorCol = 'error_msg';
      }
      
      let completedAtCol = columnMap.completedAt || 'completedAt';
      if (completedAtCol === 'completedAt' && checkColumnExists('tasks', 'completed_at')) {
        completedAtCol = 'completed_at';
      }
      
      // 确保任务的clientId不为空
      const clientIdValue = task.clientId;
      if (!clientIdValue) {
        console.error('任务的clientId为空，无法更新');
        return;
      }
      
      const updateStmt = db.prepare(`
        UPDATE tasks 
        SET ${statusCol} = ?, ${errorCol} = ?, ${completedAtCol} = ? 
        WHERE ${createdAtCol} = ? AND ${clientIdCol} = ?
      `);
      
      try {
        updateStmt.run(
          'FAILED',
          '任务创建失败，请稍后重试',
          new Date().toISOString(),
          task.createdAt,
          clientIdValue
        );
        console.log(`任务已标记为失败 [${clientIdValue}]`);
        
        // 如果有socket连接，通知客户端
        if (socket) {
          socket.emit('workflowStatusUpdate', updateData);
        } else {
          console.log('没有活跃的socket连接，跳过客户端通知');
        }
      } catch (updateError) {
        console.error('更新任务状态失败:', updateError);
      }
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
        const { apiKey, workflowId, nodeInfoList, _timestamp, clientId } = data;
        console.log('收到创建工作流请求:', { workflowId, clientId });
        
        // 确保clientId不为空，拒绝没有有效clientId的请求
        if (!clientId) {
          console.error('缺少clientId，拒绝创建任务请求');
          socket.emit('workflowError', { 
            error: '缺少客户端标识(runninghub-client-id)，请刷新页面重试' 
          });
          return;
        }
        
        // 为任务生成唯一ID
        const uniqueId = generateUUID();
        console.log('为新工作流生成 uniqueId:', uniqueId);
        
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
            createdAt: _timestamp || new Date().toISOString(),
            uniqueId,
            clientId // 直接使用传入的clientId
          };
          
          waitingTasks.push(task);
          
          // 通知客户端任务正在等待，确保状态为WAITING，并传递nodeInfoList
          const taskData = {
            taskId: null, // 确保taskId为null
            clientId, // 直接使用传入的clientId
            status: 'WAITING', // 使用字符串WAITING
            createdAt: task.createdAt,
            uniqueId,
            nodeInfoList: data.nodeInfoList // 添加nodeInfoList
          };
          
          // 保存任务到数据库
          saveTaskToDb(taskData);
          
          socket.emit('workflowCreated', taskData);
          
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
            createdAt: _timestamp || new Date().toISOString(),
            uniqueId,
            clientId // 直接使用传入的clientId
          };
          
          waitingTasks.push(task);
          
          const taskData = {
            taskId: null,
            clientId, // 直接使用传入的clientId
            status: 'RETRY', // 自定义状态：稍后重试
            createdAt: task.createdAt,
            uniqueId,
            nodeInfoList: data.nodeInfoList // 添加nodeInfoList
          };
          
          // 保存任务到数据库
          saveTaskToDb(taskData);
          
          socket.emit('workflowCreated', taskData);
          return;
        }
        
        // 成功创建工作流
        // 确保response.data.data存在
        if (response.data.data) {
          const taskData = {
            taskId: response.data.data.taskId,
            clientId, // 直接使用传入的clientId
            status: response.data.data.taskStatus,
            createdAt: _timestamp || new Date().toISOString(),
            uniqueId,
            nodeInfoList: data.nodeInfoList // 添加nodeInfoList
          };
          
          // 保存任务到数据库
          saveTaskToDb(taskData);
          
          socket.emit('workflowCreated', taskData);
        } else {
          const taskData = {
            taskId: null,
            clientId, // 直接使用传入的clientId
            status: 'SUCCESS',
            createdAt: _timestamp || new Date().toISOString(),
            uniqueId,
            nodeInfoList: data.nodeInfoList // 添加nodeInfoList
          };
          
          // 保存任务到数据库
          saveTaskToDb(taskData);
          
          socket.emit('workflowCreated', taskData);
        }
      } catch (error) {
        console.error('创建工作流时出错:', error);
        
        // 网络错误或服务器异常，发送错误通知
        socket.emit('workflowError', { error: '创建工作流时出错' });
      }
    });

    socket.on('disconnect', () => {
      console.log('客户端断开连接', socket.id);
      // 从队列中移除该客户端的活动任务，但保留数据库中的WAITING任务
      // 只从当前处理队列中移除该socket的任务
      const pendingTasksToRemove = pendingTasks.filter(task => task.socketId === socket.id);
      
      if (pendingTasksToRemove.length > 0) {
        console.log(`移除断开连接客户端的 ${pendingTasksToRemove.length} 个待处理任务`);
        // 从队列中移除
        pendingTasks.splice(0, pendingTasks.length, ...pendingTasks.filter(task => task.socketId !== socket.id));
      }
      
      // 不在这里清空该客户端的等待任务，以便前端重新连接时可以继续处理
    });

    // 修改 taskCompleted 事件处理
    socket.on('taskCompleted', (data) => {
      console.log('收到任务完成通知:', data);
      
      // 将任务结果和状态更新到数据库
      if (data.taskId) {
        const columnMap = global.columnMapping || {};
        const updateStmt = db.prepare(`
          UPDATE tasks 
          SET ${columnMap.status || 'status'} = ?, ${columnMap.completedAt || 'completedAt'} = ?, ${columnMap.result || 'result'} = ? 
          WHERE ${columnMap.taskId || 'taskId'} = ?
        `);
        
        // 处理任务结果
        let resultJson = null;
        if (data.result) {
          try {
            // 如果已经是字符串，直接使用，否则转换为JSON字符串
            resultJson = typeof data.result === 'string' 
              ? data.result 
              : JSON.stringify(data.result);
            console.log(`保存任务 ${data.taskId} 的结果到数据库`);
          } catch (jsonError) {
            console.error('任务结果JSON序列化失败:', jsonError);
          }
        }
        
        // 执行更新
        try {
          updateStmt.run(
            'SUCCESS',
            new Date().toISOString(),
            resultJson,
            data.taskId
          );
          console.log(`成功更新任务 ${data.taskId} 的状态和结果`);
        } catch (dbError) {
          console.error(`更新任务 ${data.taskId} 失败:`, dbError);
        }
      }
      
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
      
      // 从数据库中删除任务
      const columnMap = global.columnMapping || {};
      if (uniqueId) {
        const deleteStmt = db.prepare(`DELETE FROM tasks WHERE ${columnMap.uniqueId || 'uniqueId'} = ?`);
        deleteStmt.run(uniqueId);
      } else if (taskId) {
        const deleteStmt = db.prepare(`DELETE FROM tasks WHERE ${columnMap.taskId || 'taskId'} = ?`);
        deleteStmt.run(taskId);
      } else if (createdAt) {
        const deleteStmt = db.prepare(`DELETE FROM tasks WHERE ${columnMap.createdAt || 'createdAt'} = ?`);
        deleteStmt.run(createdAt);
      }
      
      // 如果是等待中的任务，根据uniqueId或createdAt从等待队列中删除
      if (isWaiting) {
        let taskIndex = -1;
        
        // 优先使用 uniqueId 查找
        if (uniqueId) {
          taskIndex = waitingTasks.findIndex(task => task.uniqueId === uniqueId);
        }
        
        // 如果未找到且有 createdAt，则使用 createdAt 作为备选
        if (taskIndex === -1 && createdAt) {
          taskIndex = waitingTasks.findIndex(task => task.createdAt === createdAt);
        }
        
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
        socket.emit('taskDeleted', { taskId, uniqueId, success: true });
      }
    });
    
    // 获取客户端任务列表
    socket.on('getClientTasks', (data) => {
      const { clientId } = data;
      console.log('获取客户端任务列表，客户端ID:', clientId);
      
      if (!clientId) {
        console.error('缺少clientId参数');
        socket.emit('clientTasks', { 
          clientId: 'unknown',
          tasks: [],
          error: '缺少clientId参数'
        });
        return;
      }
      
      // 检查数据库连接状态
      try {
        const testQuery = db.prepare('SELECT 1').get();
        console.log('数据库连接测试:', testQuery);
      } catch (dbError) {
        console.error('数据库连接测试失败:', dbError);
        // 尝试重新连接数据库
        try {
          console.log('尝试重新初始化数据库...');
          // 不创建新变量，直接使用当前变量
          db.close();
          // 重新打开数据库连接
          const newDb = new Database(dbPath);
          // 检查重新连接是否成功
          const testQuery = newDb.prepare('SELECT 1').get();
          console.log('数据库重新初始化成功:', testQuery);
        } catch (reconnectError) {
          console.error('数据库重新初始化失败:', reconnectError);
        }
      }
      
      try {
        // 检查tasks表是否存在
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get();
        console.log('任务表检查结果:', tableCheck);
        
        if (!tableCheck) {
          console.log('任务表不存在，执行初始化...');
          checkAndFixDatabaseSchema();
        }
        
        // 查询数据库
        const tasks = getClientTasks(clientId);
        console.log(`为客户端 ${clientId} 找到 ${tasks.length} 个任务`);
        
        // 发送给客户端
        socket.emit('clientTasks', { 
          clientId,
          tasks: tasks
        });
      } catch (error) {
        console.error('获取客户端任务列表时出错:', error);
        socket.emit('clientTasks', { 
          clientId,
          tasks: [],
          error: '获取任务列表失败: ' + (error instanceof Error ? error.message : String(error))
        });
      }
    });
  });

  // 启动服务器
  httpServer.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

createServer(); 