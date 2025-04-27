import { useState } from 'react';
import { Card, Typography, Button, List, Tag, Image, Collapse, Descriptions, Empty, Spin } from 'antd';
import { CaretRightOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { WorkflowTask, TaskStatus, TaskOutputItem } from '../types';
import { startPolling, stopPolling } from '../services/taskPolling';

const { Text, Title } = Typography;
const { Panel } = Collapse;

interface PollingTaskListProps {
  tasks: WorkflowTask[];
  apiKey: string;
  loadingTasks?: Record<string, boolean>;
  onPollingStatusChange?: (taskId: string, isPolling: boolean) => void;
}

export default function PollingTaskList({ 
  tasks, 
  apiKey, 
  loadingTasks = {}, 
  onPollingStatusChange 
}: PollingTaskListProps) {
  // 组件内部状态，只在未提供外部loadingTasks时使用
  const [internalLoadingTasks, setInternalLoadingTasks] = useState<Record<string, boolean>>({});
  const [expandedTasks, setExpandedTasks] = useState<string[]>([]);
  
  // 使用外部提供的loadingTasks或内部状态
  const actualLoadingTasks = onPollingStatusChange ? loadingTasks : internalLoadingTasks;
  
  // 更新任务轮询状态
  const updatePollingStatus = (taskId: string, isPolling: boolean) => {
    if (onPollingStatusChange) {
      onPollingStatusChange(taskId, isPolling);
    } else {
      setInternalLoadingTasks(prev => ({ ...prev, [taskId]: isPolling }));
    }
  };
  
  // 启动轮询
  const handleStartPolling = (taskId: string) => {
    if (!apiKey) {
      console.error('API Key不能为空');
      return;
    }
    
    updatePollingStatus(taskId, true);
    startPolling(apiKey, taskId);
  };
  
  // 停止轮询
  const handleStopPolling = (taskId: string) => {
    stopPolling(taskId);
    updatePollingStatus(taskId, false);
  };
  
  // 切换展开状态
  const handleExpand = (taskId: string) => {
    setExpandedTasks(prev => 
      prev.includes(taskId) 
        ? prev.filter(id => id !== taskId)
        : [...prev, taskId]
    );
  };
  
  // 获取当前状态的颜色
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'QUEUED':
        return 'warning';
      case 'RUNNING':
        return 'processing';
      case 'SUCCESS':
        return 'success';
      case 'FAILED':
        return 'error';
      default:
        return 'default';
    }
  };
  
  // 格式化日期
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };
  
  // 渲染输出结果
  const renderOutputs = (task: WorkflowTask) => {
    if (!task.result || typeof task.result !== 'object') {
      return null;
    }
    
    // 尝试获取输出列表
    let outputs: TaskOutputItem[] = [];
    
    if (Array.isArray(task.result)) {
      outputs = task.result as unknown as TaskOutputItem[];
    } else if (task.result && typeof task.result === 'object' && 'data' in task.result && Array.isArray(task.result.data)) {
      outputs = task.result.data as unknown as TaskOutputItem[];
    }
    
    if (outputs.length === 0) {
      return (
        <Empty description="无输出结果" />
      );
    }
    
    return (
      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3 }}
        dataSource={outputs}
        renderItem={(output) => (
          <List.Item>
            <Card 
              size="small" 
              cover={
                output.fileType.toLowerCase().match(/png|jpg|jpeg|gif|webp/) ? (
                  <div style={{ maxHeight: 200, overflow: 'hidden' }}>
                    <Image
                      src={output.fileUrl}
                      alt={`Node ${output.nodeId} output`}
                      style={{ objectFit: 'cover', width: '100%' }}
                    />
                  </div>
                ) : null
              }
            >
              <div>
                <Text strong>节点ID: {output.nodeId}</Text>
                <div>
                  <a href={output.fileUrl} target="_blank" rel="noreferrer">
                    下载 {output.fileType.toUpperCase()} 文件
                  </a>
                </div>
                {output.taskCostTime && (
                  <div>
                    <Text type="secondary">耗时: {output.taskCostTime}秒</Text>
                  </div>
                )}
              </div>
            </Card>
          </List.Item>
        )}
      />
    );
  };
  
  return (
    <div className="polling-task-list">
      <Title level={4} className="mb-4">轮询任务列表</Title>
      
      {tasks.length === 0 ? (
        <Empty description="暂无任务，请创建新工作流" />
      ) : (
        <List
          dataSource={tasks}
          renderItem={(task) => (
            <List.Item key={task.taskId}>
              <Card 
                className="w-full" 
                size="small"
                title={
                  <div className="flex justify-between items-center">
                    <Text strong>任务ID: {task.taskId}</Text>
                    <Tag color={getStatusColor(task.status)}>{task.status}</Tag>
                  </div>
                }
                extra={
                  <div className="flex space-x-2">
                    {actualLoadingTasks[task.taskId] ? (
                      <Button 
                        icon={<StopOutlined />} 
                        danger 
                        onClick={() => handleStopPolling(task.taskId)}
                      >
                        停止轮询
                      </Button>
                    ) : (
                      <Button 
                        icon={<ReloadOutlined />} 
                        type="primary" 
                        onClick={() => handleStartPolling(task.taskId)}
                        disabled={
                          task.status === TaskStatus.SUCCESS || 
                          task.status === 'SUCCESS' ||
                          task.status === TaskStatus.WAITING || 
                          task.status === 'WAITING' ||
                          !task.taskId
                        }
                      >
                        开始轮询
                      </Button>
                    )}
                    <Button 
                      type="text" 
                      onClick={() => handleExpand(task.taskId)}
                    >
                      {expandedTasks.includes(task.taskId) ? '收起' : '展开'}
                    </Button>
                  </div>
                }
              >
                <div style={{ marginTop: '8px' }}>
                  <Text type="secondary">创建时间: {formatDate(task.createdAt)}</Text>
                  {task.completedAt && (
                    <div>
                      <Text type="secondary">完成时间: {formatDate(task.completedAt)}</Text>
                    </div>
                  )}
                  
                  {actualLoadingTasks[task.taskId] && task.status !== TaskStatus.SUCCESS && (
                    <div className="mt-2">
                      <Spin size="small" /> <Text type="secondary">正在轮询查询任务状态...</Text>
                    </div>
                  )}
                  
                  {expandedTasks.includes(task.taskId) && (
                    <div className="mt-4">
                      <Collapse 
                        ghost 
                        bordered={false}
                        expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
                      >
                        <Panel header="任务详情" key="1">
                          <Descriptions column={1} bordered size="small">
                            <Descriptions.Item label="客户端ID">{task.clientId}</Descriptions.Item>
                            <Descriptions.Item label="任务状态">{task.status}</Descriptions.Item>
                            
                            {task.error && (
                              <Descriptions.Item label="错误">
                                <pre className="bg-red-50 text-red-800 p-3 rounded text-sm overflow-x-auto max-h-60">
                                  {task.error}
                                </pre>
                              </Descriptions.Item>
                            )}
                          </Descriptions>
                        </Panel>
                        
                        {(task.status === TaskStatus.SUCCESS || task.result) && (
                          <Panel header="输出结果" key="2">
                            {renderOutputs(task)}
                          </Panel>
                        )}
                      </Collapse>
                    </div>
                  )}
                </div>
              </Card>
            </List.Item>
          )}
        />
      )}
    </div>
  );
} 