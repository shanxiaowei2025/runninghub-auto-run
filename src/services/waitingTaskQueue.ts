import { NodeInfo, WorkflowTask } from '../types';
import { createWaitingTask } from './taskPolling';
import { socket } from './socket';

// 等待队列中的任务
interface WaitingTask {
  apiKey: string;
  workflowId: string;
  nodeInfoList: NodeInfo[];
  clientId?: string;
  uniqueId?: string;
  createdAt: string;
}

// 存储等待队列中的任务
const waitingTasks: WaitingTask[] = [];
let isProcessingWaitingTasks = false;

/**
 * 将任务添加到等待队列
 */
export const addToWaitingQueue = (task: WaitingTask): void => {
  waitingTasks.push(task);
  console.log(`任务已添加到等待队列，当前队列长度: ${waitingTasks.length}`);
  
  // 如果当前没有正在处理的任务，尝试处理队列
  if (!isProcessingWaitingTasks) {
    processWaitingQueue();
  }
};

/**
 * 处理等待队列中的任务
 */
export const processWaitingQueue = async (): Promise<void> => {
  // 如果队列为空或已经有处理过程在进行，则返回
  if (waitingTasks.length === 0 || isProcessingWaitingTasks) {
    return;
  }
  
  // 标记为正在处理
  isProcessingWaitingTasks = true;
  
  // 获取队列中的第一个任务但不从队列中移除
  const task = waitingTasks[0];
  
  try {
    console.log('尝试创建等待队列中的任务:', task.workflowId);
    
    // 调用 API 创建任务
    const response = await createWaitingTask(
      task.apiKey,
      task.workflowId,
      task.nodeInfoList
    );
    
    // 如果返回队列已满错误，暂停处理
    if (response.code === 421 && response.msg === 'TASK_QUEUE_MAXED') {
      console.log('任务队列已满，等待中...');
      isProcessingWaitingTasks = false;
      return;
    }
    
    // 任务创建成功，从队列中移除
    if (response.success) {
      const createdTask = waitingTasks.shift();
      console.log(`等待任务创建成功，从队列中移除，剩余 ${waitingTasks.length} 个任务`);
      
      // 通知客户端任务创建成功
      if (response.data && createdTask) {
        const taskData: WorkflowTask = {
          taskId: response.data.taskId,
          clientId: createdTask.clientId || '',
          status: response.data.taskStatus,
          createdAt: createdTask.createdAt,
          uniqueId: createdTask.uniqueId || '',
          nodeInfoList: createdTask.nodeInfoList
        };
        
        // 如果socket连接可用，通知客户端
        if (socket.connected) {
          socket.emit('workflowCreated', taskData);
        }
      }
      
      // 继续处理下一个任务
      setTimeout(processWaitingQueue, 500);
    } else {
      // 处理失败，可能是其他错误
      console.error('创建等待任务失败:', response.msg);
      // 从队列中移除该任务
      waitingTasks.shift();
      isProcessingWaitingTasks = false;
      
      // 继续处理下一个任务
      setTimeout(processWaitingQueue, 1000);
    }
  } catch (error) {
    console.error('处理等待任务时发生错误:', error);
    isProcessingWaitingTasks = false;
    
    // 稍后重试
    setTimeout(processWaitingQueue, 3000);
  }
};

/**
 * 当有非等待任务完成时，尝试处理等待队列
 */
export const onTaskCompleted = (): void => {
  console.log('任务完成，检查等待队列...');
  if (waitingTasks.length > 0 && !isProcessingWaitingTasks) {
    // 等待短暂时间后处理，避免请求过于频繁
    setTimeout(processWaitingQueue, 1000);
  }
};

/**
 * 从等待队列中移除任务
 */
export const removeFromWaitingQueue = (uniqueId: string): boolean => {
  const index = waitingTasks.findIndex(task => task.uniqueId === uniqueId);
  
  if (index !== -1) {
    waitingTasks.splice(index, 1);
    console.log(`任务已从等待队列中移除，剩余 ${waitingTasks.length} 个任务`);
    return true;
  }
  
  return false;
};

/**
 * 获取等待队列中的任务数量
 */
export const getWaitingTasksCount = (): number => {
  return waitingTasks.length;
}; 