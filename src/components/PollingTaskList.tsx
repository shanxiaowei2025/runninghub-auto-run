import React, { useEffect, useState, useMemo } from 'react';
import { List, Card, Button, Typography, Space, Tag, Divider, Image, Empty, Modal, Collapse, Statistic, Row, Col, Tooltip, Descriptions, Spin } from 'antd';
import { 
  SyncOutlined, CheckCircleOutlined, CloseCircleOutlined, 
  UpOutlined, DownOutlined, DeleteOutlined, 
  PlayCircleOutlined, PauseCircleOutlined, AppstoreOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, NodeIndexOutlined
} from '@ant-design/icons';
import { NodeInfo, TaskOutputItem, TaskStatus, WorkflowTask } from '../types';
import { startPolling, stopPolling } from '../services/taskPolling';

const { Text, Paragraph, Title } = Typography;
const { confirm } = Modal;
const { Panel } = Collapse;

interface PollingTaskListProps {
  tasks: WorkflowTask[];
  apiKey: string;
  loadingTasks?: Record<string, boolean>;
  onPollingStatusChange?: (taskId: string, isPolling: boolean) => void;
  onDeleteTask?: (taskIdOrUniqueId: string, isUniqueId: boolean, task?: WorkflowTask) => void;
}

// 为任务增加前端临时标识符
interface EnhancedWorkflowTask extends WorkflowTask {
  tempId?: string;
}

// 自定义统计组件，标题不换行
const NoWrapStatistic = ({ title, value, prefix, valueStyle }: {
  title: string;
  value: number;
  prefix?: React.ReactNode;
  valueStyle?: React.CSSProperties;
}) => (
  <Tooltip title={title}>
    <div>
      <Statistic 
        title={
          <div style={{ 
            whiteSpace: 'nowrap', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis',
            width: '100%'
          }}>
            {title}
          </div>
        }
        value={value} 
        prefix={prefix} 
        valueStyle={valueStyle}
      />
    </div>
  </Tooltip>
);

// 渲染按钮操作区域
const renderTaskActions = (task: EnhancedWorkflowTask, 
                          isPolling: boolean, 
                          isExpanded: boolean,
                          onStartPolling: () => void, 
                          onStopPolling: () => void, 
                          onExpand: () => void, 
                          onDelete: () => void) => {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      {/* 轮询按钮 */}
      {isPolling ? (
        <Tooltip title="停止轮询查询任务状态">
          <Button 
            icon={<PauseCircleOutlined />} 
            danger
            type="text"
            onClick={onStopPolling}
          />
        </Tooltip>
      ) : (
        <Tooltip title="开始轮询查询任务状态">
          <Button 
            icon={<PlayCircleOutlined />} 
            type="text"
            onClick={onStartPolling}
            disabled={
              task.status === TaskStatus.SUCCESS || 
              task.status === 'SUCCESS' ||
              task.status === TaskStatus.WAITING || 
              task.status === 'WAITING' ||
              !task.taskId
            }
            style={{ 
              color: (task.status === TaskStatus.SUCCESS || 
                    task.status === 'SUCCESS' ||
                    task.status === TaskStatus.WAITING || 
                    task.status === 'WAITING' ||
                    !task.taskId) ? undefined : '#1677ff'
            }}
          />
        </Tooltip>
      )}
      
      {/* 展开/收起按钮 */}
      <Tooltip title={isExpanded ? "收起详情" : "展开详情"}>
        <Button 
          icon={isExpanded ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          type="text"
          onClick={onExpand}
        />
      </Tooltip>
      
      {/* 删除按钮 */}
      <Tooltip title="从任务列表中删除">
        <Button
          icon={<DeleteOutlined />}
          danger
          type="text"
          onClick={onDelete}
        />
      </Tooltip>
    </div>
  );
};

export default function PollingTaskList({ 
  tasks, 
  apiKey, 
  loadingTasks = {}, 
  onPollingStatusChange,
  onDeleteTask
}: PollingTaskListProps) {
  // 组件内部状态，只在未提供外部loadingTasks时使用
  const [internalLoadingTasks, setInternalLoadingTasks] = useState<Record<string, boolean>>({});
  const [expandedTasks, setExpandedTasks] = useState<string[]>([]);
  const [allExpanded, setAllExpanded] = useState<boolean>(true);
  
  // 使用外部提供的loadingTasks或内部状态
  const actualLoadingTasks = onPollingStatusChange ? loadingTasks : internalLoadingTasks;
  
  // 为每个任务生成唯一ID
  const tasksWithUniqueIds = useMemo<EnhancedWorkflowTask[]>(() => {
    return tasks.map((task, index) => ({
      ...task,
      tempId: task.taskId ? task.taskId : `waiting-task-${index}`
    }));
  }, [tasks]);
  
  // 计算任务统计信息
  const taskStats = useMemo(() => {
    const totalTasks = tasks.length;
    
    const completedTasks = tasks.filter(task => 
      task.status === TaskStatus.SUCCESS || 
      task.status === 'SUCCESS'
    ).length;
    
    const waitingTasks = tasks.filter(task => 
      task.status === TaskStatus.WAITING || 
      task.status === 'WAITING' ||
      task.status === TaskStatus.QUEUED || 
      task.status === 'QUEUED'
    ).length;
    
    const failedTasks = tasks.filter(task => 
      task.status === TaskStatus.FAILED || 
      task.status === 'FAILED'
    ).length;
    
    const runningTasks = tasks.filter(task => 
      task.status === TaskStatus.RUNNING || 
      task.status === 'RUNNING'
    ).length;
    
    return { 
      totalTasks, 
      completedTasks, 
      waitingTasks,
      failedTasks,
      runningTasks
    };
  }, [tasks]);
  
  // 初始化时设置全部任务展开 - 使用tempId
  useEffect(() => {
    if (tasksWithUniqueIds.length > 0) {
      setExpandedTasks(tasksWithUniqueIds.map(task => task.tempId));
    }
  }, [tasksWithUniqueIds]);
  
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
  
  // 处理展开/收起详情
  const handleExpand = (tempId: string) => {
    if (expandedTasks.includes(tempId)) {
      // 收起
      setExpandedTasks(expandedTasks.filter(id => id !== tempId));
    } else {
      // 展开
      const newExpandedTasks = [...expandedTasks, tempId].filter((id): id is string => id !== undefined);
      setExpandedTasks(newExpandedTasks);
    }
  };
  
  // 切换全部展开/收起
  const toggleAllExpanded = () => {
    if (allExpanded) {
      // 收起全部
      setExpandedTasks([]);
    } else {
      // 展开全部
      const tempIds = tasksWithUniqueIds.map(task => task.tempId).filter((id): id is string => id !== undefined);
      setExpandedTasks(tempIds);
    }
    setAllExpanded(!allExpanded);
  };
  
  // 删除所有任务
  const handleDeleteAllTasks = () => {
    confirm({
      title: '确认删除',
      icon: <ExclamationCircleOutlined />,
      content: '确定要删除所有任务吗？此操作不可恢复！',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk() {
        // 先停止所有正在轮询的任务
        tasksWithUniqueIds.forEach(task => {
          if (task.taskId && actualLoadingTasks[task.taskId]) {
            handleStopPolling(task.taskId);
          }
        });
        
        // 然后删除所有任务
        if (onDeleteTask) {
          tasksWithUniqueIds.forEach(task => {
            // 对于WAITING状态的任务，使用uniqueId进行删除
            if ((task.status === TaskStatus.WAITING || task.status === 'WAITING' || 
                 task.status === TaskStatus.RETRY || task.status === 'RETRY') && task.uniqueId) {
              // 使用类型断言确保uniqueId是字符串类型
              onDeleteTask(task.uniqueId as string, true, task);
            } else if (task.taskId) {
              // 对于其他状态的任务，使用taskId进行删除
              onDeleteTask(task.taskId, false, task);
            }
          });
        }
      },
    });
  };
  
  // 获取当前状态的颜色
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'QUEUED':
      case TaskStatus.QUEUED:
        return 'warning';
      case 'RUNNING':
      case TaskStatus.RUNNING:
        return 'processing';
      case 'SUCCESS':
      case TaskStatus.SUCCESS:
        return 'success';
      case 'FAILED':
      case TaskStatus.FAILED:
        return 'error';
      case 'RETRY':
      case TaskStatus.RETRY:
        return 'gold'; // 使用金色表示重试状态
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
  
  // 渲染节点信息
  const renderNodeInfo = (nodeInfoList: NodeInfo[]) => {
    if (!nodeInfoList || nodeInfoList.length === 0) {
      return null;
    }
    
    // 按节点ID分组
    const nodeGroups: Record<string, NodeInfo[]> = {};
    nodeInfoList.forEach(node => {
      if (!nodeGroups[node.nodeId]) {
        nodeGroups[node.nodeId] = [];
      }
      nodeGroups[node.nodeId].push(node);
    });
    
    return (
      <div className="node-info-container" style={{ marginTop: '16px' }}>
        <Divider orientation="left">
          <NodeIndexOutlined /> 节点信息
        </Divider>
        <List
          grid={{ gutter: 16, column: 1 }}
          dataSource={Object.entries(nodeGroups)}
          renderItem={([nodeId, nodes]) => (
            <List.Item>
              <Card 
                size="small" 
                title={`节点 ID: ${nodeId}`}
                style={{ backgroundColor: '#f9f9f9' }}
              >
                <Descriptions 
                  size="small" 
                  column={1} 
                  bordered
                >
                  {nodes.map((node, index) => (
                    <Descriptions.Item 
                      key={index} 
                      label={node.fieldName}
                    >
                      {typeof node.fieldValue === 'string' && node.fieldValue.length > 50 
                        ? <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}>{node.fieldValue}</Paragraph>
                        : node.fieldValue.toString()}
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </Card>
            </List.Item>
          )}
        />
      </div>
    );
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
      <div className="outputs-container" style={{ marginTop: '16px' }}>
        <Divider orientation="left">输出结果</Divider>
        <List
          grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3 }}
          dataSource={outputs}
          renderItem={(output) => (
            <List.Item>
              <Card 
                size="small" 
                cover={
                  output.fileType.toLowerCase().match(/png|jpg|jpeg|gif|webp/) ? (
                    <Image
                      src={output.fileUrl}
                      alt={`输出图片`}
                      style={{ width: '100%' }}
                    />
                  ) : output.fileType.toLowerCase().match(/mp4|webm|ogg|mov/) ? (
                    <video
                      controls
                      src={output.fileUrl}
                      style={{ width: '100%' }}
                      preload="metadata"
                    >
                      您的浏览器不支持视频播放
                    </video>
                  ) : null
                }
                style={{ height: '100%' }}
              >
                <div>
                  <div>
                    <a href={output.fileUrl} target="_blank" rel="noreferrer">
                      {output.fileType.toLowerCase().match(/mp4|webm|ogg|mov/) 
                        ? `观看${output.fileType.toUpperCase()}视频` 
                        : `下载 ${output.fileType.toUpperCase()} 文件`}
                    </a>
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <Text type="secondary">图片链接: </Text>
                    <Paragraph copyable ellipsis={{ rows: 1, expandable: true, symbol: '展开' }}>
                      {output.fileUrl}
                    </Paragraph>
                  </div>
                  {output.taskCostTime && (
                    <div>
                      <Text type="secondary">耗时: {output.taskCostTime}秒</Text>
                    </div>
                  )}
                  {output.fileType.toLowerCase().match(/mp4|webm|ogg|mov/) && (
                    <div style={{ marginTop: '8px' }}>
                      <Text type="secondary">提示: 可直接在此页面播放视频</Text>
                    </div>
                  )}
                </div>
              </Card>
            </List.Item>
          )}
        />
      </div>
    );
  };
  
  // 删除任务
  const handleDeleteTask = (task: EnhancedWorkflowTask) => {
    // 如果任务正在轮询，先停止轮询
    if (task.taskId && actualLoadingTasks[task.taskId]) {
      handleStopPolling(task.taskId);
    }
    
    // 调用外部删除函数
    if (onDeleteTask) {
      // 对于WAITING状态或RETRY状态的任务，使用uniqueId进行删除
      if ((task.status === TaskStatus.WAITING || task.status === 'WAITING' || 
           task.status === TaskStatus.RETRY || task.status === 'RETRY') && task.uniqueId) {
        // 使用类型断言确保uniqueId是字符串类型
        onDeleteTask(task.uniqueId as string, true, task);
      } else if (task.taskId) {
        // 对于其他状态的任务，使用taskId进行删除
        onDeleteTask(task.taskId, false, task);
      }
    }
  };
  
  return (
    <div className="polling-task-list">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <Title level={4} style={{ margin: 0 }}>轮询任务列表</Title>
        {tasksWithUniqueIds.length > 0 && (
          <Space>
            <Button 
              type="link" 
              icon={allExpanded ? <UpOutlined /> : <DownOutlined />}
              onClick={toggleAllExpanded}
            >
              {allExpanded ? '收起全部' : '展开全部'}
            </Button>
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteAllTasks}
            >
              删除全部
            </Button>
          </Space>
        )}
      </div>
      
      {tasksWithUniqueIds.length > 0 && (
        <div style={{ marginBottom: '20px', background: '#f5f5f5', padding: '16px', borderRadius: '8px' }}>
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={8} md={4}>
              <NoWrapStatistic 
                title="全部" 
                value={taskStats.totalTasks} 
                prefix={<AppstoreOutlined />} 
                valueStyle={{ color: '#1677ff' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <NoWrapStatistic 
                title="已完成" 
                value={taskStats.completedTasks} 
                prefix={<CheckCircleOutlined />} 
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <NoWrapStatistic 
                title="进行中" 
                value={taskStats.runningTasks} 
                prefix={<SyncOutlined spin={taskStats.runningTasks > 0} />} 
                valueStyle={{ color: '#1890ff' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <NoWrapStatistic 
                title="等待中" 
                value={taskStats.waitingTasks} 
                prefix={<ClockCircleOutlined />} 
                valueStyle={{ color: '#faad14' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <NoWrapStatistic 
                title="失败" 
                value={taskStats.failedTasks} 
                prefix={<CloseCircleOutlined />} 
                valueStyle={{ color: '#f5222d' }}
              />
            </Col>
          </Row>
        </div>
      )}
      
      {tasksWithUniqueIds.length === 0 ? (
        <Empty description="暂无任务，请创建新工作流" />
      ) : (
        <List
          dataSource={tasksWithUniqueIds}
          renderItem={(task) => (
            <List.Item key={task.tempId}>
              <Card 
                className="w-full" 
                size="small"
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong>任务ID: {task.taskId || '等待中'}</Text>
                    <Tag color={getStatusColor(task.status)}>{task.status}</Tag>
                  </div>
                }
                extra={renderTaskActions(
                  task,
                  !!(task.taskId && actualLoadingTasks[task.taskId]),
                  !!(task.tempId && expandedTasks.includes(task.tempId)),
                  () => task.taskId && handleStartPolling(task.taskId),
                  () => task.taskId && handleStopPolling(task.taskId),
                  () => task.tempId && handleExpand(task.tempId),
                  () => handleDeleteTask(task)
                )}
                style={{ width: '100%', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}
              >
                <div style={{ marginTop: '8px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                    <Text type="secondary">创建时间: {formatDate(task.createdAt)}</Text>
                    {task.completedAt && (
                      <Text type="secondary">完成时间: {formatDate(task.completedAt)}</Text>
                    )}
                  </div>
                  
                  {task.taskId && actualLoadingTasks[task.taskId] && task.status !== TaskStatus.SUCCESS && (
                    <div style={{ marginTop: '8px' }}>
                      <Spin size="small" /> <Text type="secondary">正在轮询查询任务状态...</Text>
                    </div>
                  )}
                  
                  {task.tempId && expandedTasks.includes(task.tempId) && (
                    <div style={{ marginTop: '16px' }}>
                      {/* 显示节点信息（如果存在） */}
                      {task.nodeInfoList && task.nodeInfoList.length > 0 && 
                        renderNodeInfo(task.nodeInfoList)
                      }
                      
                      {/* 显示任务结果（如果存在） */}
                      {(task.status === TaskStatus.SUCCESS || task.result) && 
                        renderOutputs(task)
                      }
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