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
};

// 创建工作流
export const createWorkflow = (data: CreateWorkflowRequest): void => {
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
export const onWorkflowStatusUpdate = (callback: (data: any) => void): void => {
  socket.on(socketEvents.workflowStatusUpdate, callback);
};

// 添加任务完成通知函数
export const notifyTaskCompleted = (taskId: string): void => {
  socket.emit(socketEvents.taskCompleted, { taskId });
};

// 清除所有事件监听
export const clearAllListeners = (): void => {
  socket.off(socketEvents.connect);
  socket.off(socketEvents.disconnect);
  socket.off(socketEvents.workflowCreated);
  socket.off(socketEvents.workflowError);
  socket.off(socketEvents.workflowStatusUpdate);
  socket.off(socketEvents.taskCompleted);
}; 