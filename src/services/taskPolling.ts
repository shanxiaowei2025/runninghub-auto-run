import { TaskStatus, TaskStatusResponse, TaskOutputsResponse, PollingTaskResult } from '../types';
import { notifyTaskCompleted, socket } from './socket'; // 导入通知函数和socket对象

// API配置
const API_BASE_URL = 'https://www.runninghub.cn';
const POLLING_INTERVAL = 5000; // 5秒轮询一次

// 存储当前正在轮询的任务ID和对应的定时器ID
const pollingTasks = new Map<string, number>();

// Socket事件名称
export const pollingEvents = {
  taskStatusUpdate: 'taskStatusUpdate',
  taskOutputsUpdate: 'taskOutputsUpdate',
  taskError: 'taskError',
};

// 事件回调集合
type CallbackFunction = (data: PollingTaskResult) => void;
const callbackMap = new Map<string, CallbackFunction[]>();

// 注册事件监听
export const onPollingEvent = (eventName: string, callback: CallbackFunction): void => {
  if (!callbackMap.has(eventName)) {
    callbackMap.set(eventName, []);
  }
  callbackMap.get(eventName)?.push(callback);
};

// 触发事件
const triggerEvent = (eventName: string, data: PollingTaskResult): void => {
  const callbacks = callbackMap.get(eventName);
  if (callbacks) {
    callbacks.forEach(callback => callback(data));
  }
};

// 查询任务状态
const fetchTaskStatus = async (apiKey: string, taskId: string): Promise<TaskStatusResponse> => {
  try {
    const response = await fetch(`${API_BASE_URL}/task/openapi/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'www.runninghub.cn',
      },
      body: JSON.stringify({ apiKey, taskId }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('获取任务状态失败:', error);
    throw error;
  }
};

// 查询任务输出结果
const fetchTaskOutputs = async (apiKey: string, taskId: string): Promise<TaskOutputsResponse> => {
  try {
    const response = await fetch(`${API_BASE_URL}/task/openapi/outputs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'www.runninghub.cn',
      },
      body: JSON.stringify({ apiKey, taskId }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('获取任务结果失败:', error);
    throw error;
  }
};

// 解析任务状态
const parseTaskStatus = (statusData: string): TaskStatus => {
  try {
    // 状态可能是直接的字符串或包含在JSON中的字段
    const parsedData = typeof statusData === 'string' && statusData.startsWith('{')
      ? JSON.parse(statusData)
      : { status: statusData };
    
    const status = parsedData.status || statusData;
    
    // 将状态映射到TaskStatus枚举
    switch (status.toUpperCase()) {
      case 'CREATE':
        return TaskStatus.CREATED;
      case 'SUCCESS':
        return TaskStatus.SUCCESS;
      case 'FAILED':
        return TaskStatus.FAILED;
      case 'RUNNING':
        return TaskStatus.RUNNING;
      case 'QUEUED':
        return TaskStatus.QUEUED;
      case 'WAITING':
        return TaskStatus.WAITING;
      default:
        return status as TaskStatus;
    }
  } catch (error) {
    console.error('解析任务状态失败:', error);
    return statusData as TaskStatus;
  }
};

// 轮询任务状态
const pollTaskStatus = async (apiKey: string, taskId: string) => {
  try {
    const statusResponse = await fetchTaskStatus(apiKey, taskId);
    
    if (statusResponse.code !== 0) {
      triggerEvent(pollingEvents.taskError, {
        taskId,
        status: TaskStatus.FAILED,
        error: statusResponse.msg || '查询任务状态失败',
      });
      // 任务失败，通知服务器
      notifyTaskCompleted(taskId);
      stopPolling(taskId);
      return;
    }
    
    const status = parseTaskStatus(statusResponse.data);
    
    // 触发状态更新事件
    triggerEvent(pollingEvents.taskStatusUpdate, {
      taskId,
      status,
    });
    
    // 如果任务已完成，查询输出结果
    if (status === TaskStatus.SUCCESS) {
      try {
        const outputsResponse = await fetchTaskOutputs(apiKey, taskId);
        
        if (outputsResponse.code === 0 && outputsResponse.data) {
          // 触发输出结果更新事件
          triggerEvent(pollingEvents.taskOutputsUpdate, {
            taskId,
            status,
            outputs: outputsResponse.data,
          });
          
          // 任务成功完成，停止轮询并通知服务器，带上结果
          stopPolling(taskId);
          // 添加socket连接状态检查
          if (socket.connected) {
            notifyTaskCompleted(taskId, { data: outputsResponse.data });
          } else {
            console.warn('Socket断开连接，无法发送任务完成通知');
          }
          return; // 提前返回，避免重复调用
        }
      } catch (outputError) {
        console.error('获取任务输出失败:', outputError);
      }
      
      // 如果获取输出失败或没有输出，仍然标记任务完成
      stopPolling(taskId);
      if (socket.connected) {
        notifyTaskCompleted(taskId);
      } else {
        console.warn('Socket断开连接，无法发送任务完成通知');
      }
    } else if (status === TaskStatus.FAILED) {
      // 任务失败，停止轮询并通知服务器
      triggerEvent(pollingEvents.taskError, {
        taskId,
        status,
        error: '任务执行失败',
      });
      stopPolling(taskId);
      // 添加socket连接状态检查
      if (socket.connected) {
        notifyTaskCompleted(taskId, { error: '任务执行失败' });
      } else {
        console.warn('Socket断开连接，无法发送任务完成通知');
      }
    }
  } catch (error) {
    console.error('轮询任务状态失败:', error);
    triggerEvent(pollingEvents.taskError, {
      taskId,
      status: TaskStatus.FAILED,
      error: error instanceof Error ? error.message : '轮询任务状态失败',
    });
    // 轮询出错，停止轮询并通知服务器
    stopPolling(taskId);
    // 添加socket连接状态检查
    if (socket.connected) {
      notifyTaskCompleted(taskId, { error: error instanceof Error ? error.message : '轮询任务状态失败' });
    } else {
      console.warn('Socket断开连接，无法发送任务完成通知');
    }
  }
};

// 开始轮询任务
export const startPolling = (apiKey: string, taskId: string): void => {
  // 检查任务ID是否有效
  if (!taskId || taskId === 'null' || taskId === 'undefined') {
    console.warn('无法轮询无效的任务ID');
    return;
  }
  
  // 如果已经在轮询，先停止
  if (pollingTasks.has(taskId)) {
    stopPolling(taskId);
  }
  
  // 立即执行一次，然后设置定时轮询
  pollTaskStatus(apiKey, taskId);
  
  const timerId = window.setInterval(() => {
    pollTaskStatus(apiKey, taskId);
  }, POLLING_INTERVAL);
  
  pollingTasks.set(taskId, timerId);
  console.log(`开始轮询任务 ${taskId}`);
};

// 停止轮询任务
export const stopPolling = (taskId: string): void => {
  const timerId = pollingTasks.get(taskId);
  if (timerId) {
    clearInterval(timerId);
    pollingTasks.delete(taskId);
    console.log(`停止轮询任务 ${taskId}`);
  }
};

// 清除所有事件监听
export const clearAllPollingListeners = (): void => {
  callbackMap.clear();
  
  // 停止所有轮询
  pollingTasks.forEach((timerId, taskId) => {
    clearInterval(timerId);
    console.log(`停止轮询任务 ${taskId}`);
  });
  pollingTasks.clear();
}; 