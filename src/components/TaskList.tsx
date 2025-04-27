import { WorkflowTask } from '../types';
import { List, Typography, Tag, Collapse, Descriptions, Empty } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;
const { Panel } = Collapse;

interface TaskListProps {
  tasks: WorkflowTask[];
}

export default function TaskList({ tasks }: TaskListProps) {
  // 获取当前状态的颜色
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'QUEUED':
        return 'warning';
      case 'WAITING':
        return 'default';
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

  return (
    <div>
      <Title level={4} className="mb-4">工作流任务列表</Title>
      
      {tasks.length === 0 ? (
        <Empty description="暂无任务，请创建新工作流" />
      ) : (
        <List
          dataSource={tasks}
          renderItem={(task) => (
            <List.Item key={task.taskId}>
              <Collapse 
                ghost 
                bordered={false}
                className="w-full"
                expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
              >
                <Panel 
                  header={
                    <div className="flex justify-between w-full">
                      <div>
                        <Text strong>{task.taskId}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: '12px' }}>
                            创建时间: {formatDate(task.createdAt)}
                          </Text>
                        </div>
                      </div>
                      <Tag color={getStatusColor(task.status)}>{task.status}</Tag>
                    </div>
                  } 
                  key="1"
                >
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="客户端ID">{task.clientId}</Descriptions.Item>
                    
                    {task.completedAt && (
                      <Descriptions.Item label="完成时间">{formatDate(task.completedAt)}</Descriptions.Item>
                    )}
                    
                    {task.result && (
                      <Descriptions.Item label="结果">
                        <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto max-h-60">
                          {typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2)}
                        </pre>
                      </Descriptions.Item>
                    )}
                    
                    {task.error && (
                      <Descriptions.Item label="错误">
                        <pre className="bg-red-50 text-red-800 p-3 rounded text-sm overflow-x-auto max-h-60">
                          {task.error}
                        </pre>
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                </Panel>
              </Collapse>
            </List.Item>
          )}
        />
      )}
    </div>
  );
} 