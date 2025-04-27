// RunningHub API 类型定义
export interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string | number | boolean;
}

export interface CreateWorkflowRequest {
  apiKey: string;
  workflowId: string;
  nodeInfoList: NodeInfo[];
  webhookUrl?: string;
  addMetadata?: boolean;
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
  QUEUED = 'QUEUED'
}

export interface WorkflowTask {
  taskId: string;
  clientId: string;
  status: TaskStatus | string;
  result?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface WebhookCallbackData {
  taskId: string;
  event: string;
  data: string;
  receivedAt: string;
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