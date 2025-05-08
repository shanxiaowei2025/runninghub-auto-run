// RunningHub API 类型定义
export interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string | number | boolean;
  jsonFile?: string;
}

export interface CreateWorkflowRequest {
  apiKey: string;
  workflowId: string;
  nodeInfoList: NodeInfo[];
  addMetadata?: boolean;
  _timestamp?: string;
  taskInterval?: number;
}

export interface TaskCreateResponse {
  netWssUrl: string | null;
  taskId: string;
  clientId: string;
  taskStatus: TaskStatus;
  promptTips: string;
}

export enum TaskStatus {
  CREATED = 'CREATE',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  RUNNING = 'RUNNING',
  QUEUED = 'QUEUED',
  WAITING = 'WAITING',
  RETRY = 'RETRY'
}

export interface WorkflowTask {
  taskId: string | null;
  clientId: string;
  status: TaskStatus | string;
  result?: Record<string, unknown>;
  createdAt: string;
  uniqueId: string;
  completedAt?: string;
  error?: string;
  nodeInfoList?: NodeInfo[];
  taskInterval?: number;
}

// 轮询任务相关类型定义
export interface TaskStatusResponse {
  code: number;
  msg: string;
  data: string;
}

export interface TaskOutputItem {
  fileUrl: string;
  fileType: string;
  taskCostTime: string;
  nodeId: string;
}

export interface TaskOutputsResponse {
  code: number;
  msg: string;
  data: TaskOutputItem[];
}

export interface PollingTaskResult {
  taskId: string;
  status: TaskStatus;
  outputs?: TaskOutputItem[];
  error?: string;
} 