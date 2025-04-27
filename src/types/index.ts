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
  result?: any;
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