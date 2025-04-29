import { io, Socket } from 'socket.io-client';
import { CreateWorkflowRequest, WorkflowTask } from '../types';

// 创建Socket.io客户端实例
export const socket: Socket = io({
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

// Socket连接状态
export const socketEvents = {
  connect: 'connect',
  disconnect: 'disconnect',
  workflowCreated: 'workflowCreated',
  workflowError: 'workflowError',
  workflowStatusUpdate: 'workflowStatusUpdate',
  taskCompleted: 'taskCompleted',
  taskDeleted: 'taskDeleted',
  taskRecoveryUpdate: 'taskRecoveryUpdate',
};

// 创建工作流
export const createWorkflow = (data: CreateWorkflowRequest & { clientId?: string }): void => {
  socket.emit('createWorkflow', data);
};

// 监听连接成功事件
export const onConnect = (callback: () => void): void => {
  socket.on(socketEvents.connect, callback);
};

// 监听断开连接事件
export const onDisconnect = (callback: (reason: string) => void): void => {
  socket.on(socketEvents.disconnect, callback);
};

// 监听工作流创建成功事件
export const onWorkflowCreated = (callback: (task: WorkflowTask) => void): void => {
  socket.on(socketEvents.workflowCreated, callback);
};

// 监听工作流创建错误事件
export const onWorkflowError = (callback: (error: { error: string }) => void): void => {
  socket.on(socketEvents.workflowError, callback);
};

// 监听工作流状态更新事件
export interface WorkflowStatusUpdate {
  originalCreatedAt: string;
  taskId: string | null;
  status: string;
  createdAt: string;
  error?: string;
}

export const onWorkflowStatusUpdate = (callback: (data: WorkflowStatusUpdate) => void): void => {
  socket.on(socketEvents.workflowStatusUpdate, callback);
};

// 添加任务完成通知函数
export const notifyTaskCompleted = (taskId: string, result?: Record<string, unknown>): void => {
  socket.emit(socketEvents.taskCompleted, { taskId, result });
};

// 通知服务器删除任务
export const notifyDeleteTask = (uniqueId: string, taskId: string | null, createdAt: string, isWaiting: boolean): void => {
  socket.emit('deleteTask', { uniqueId, taskId, createdAt, isWaiting });
};

// 请求获取客户端任务
export const requestClientTasks = (clientId: string): void => {
  socket.emit('getClientTasks', { clientId });
};

// 监听客户端任务响应
export const onClientTasks = (callback: (data: { clientId: string, tasks: WorkflowTask[], error?: string }) => void): void => {
  socket.on('clientTasks', callback);
};

// 添加删除任务成功事件监听
export interface TaskDeletedResponse {
  taskId?: string;
  uniqueId?: string; 
  success: boolean;
  error?: string;
}

export const onTaskDeleted = (callback: (data: TaskDeletedResponse) => void): void => {
  socket.on(socketEvents.taskDeleted, callback);
};

// 监听任务恢复更新事件
export interface TaskRecoveryUpdate {
  clientId: string;
  createdAt: string;
  originalCreatedAt: string;
  taskId: string | null;
  status: string;
  message?: string;
}

export const onTaskRecoveryUpdate = (callback: (data: TaskRecoveryUpdate) => void): void => {
  socket.on(socketEvents.taskRecoveryUpdate, callback);
};

// 清除所有事件监听
export const clearAllListeners = (): void => {
  socket.off(socketEvents.connect);
  socket.off(socketEvents.disconnect);
  socket.off(socketEvents.workflowCreated);
  socket.off(socketEvents.workflowError);
  socket.off(socketEvents.workflowStatusUpdate);
  socket.off(socketEvents.taskCompleted);
  socket.off(socketEvents.taskDeleted);
  socket.off(socketEvents.taskRecoveryUpdate);
  socket.off('clientTasks');
}; 