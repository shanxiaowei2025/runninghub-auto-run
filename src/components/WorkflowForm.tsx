import { useState } from 'react';
import { NodeInfo } from '../types';
import { createWorkflow } from '../services/socket';
import { Form, Input, Button, Card, Typography, Row, Col, Divider, Space, message, InputNumber } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface WorkflowFormProps {
  onSubmit: () => void;
  onApiKeyChange?: (apiKey: string) => void;
}

interface FormValues {
  apiKey: string;
  workflowId: string;
}

// 任务分组接口
interface TaskGroup {
  nodeInfoList: NodeInfo[];
  executionCount: number;
}

export default function WorkflowForm({ onSubmit, onApiKeyChange }: WorkflowFormProps) {
  const [form] = Form.useForm();
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([
    { 
      nodeInfoList: [{ nodeId: '', fieldName: '', fieldValue: '' }],
      executionCount: 1
    }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 添加一个新的任务组
  const addTaskGroup = () => {
    setTaskGroups([
      ...taskGroups, 
      { 
        nodeInfoList: [{ nodeId: '', fieldName: '', fieldValue: '' }],
        executionCount: 1
      }
    ]);
  };

  // 删除任务组
  const removeTaskGroup = (groupIndex: number) => {
    if (taskGroups.length > 1) {
      const newGroups = [...taskGroups];
      newGroups.splice(groupIndex, 1);
      setTaskGroups(newGroups);
    }
  };

  // 更新任务组的执行次数
  const updateExecutionCount = (groupIndex: number, count: number) => {
    const newGroups = [...taskGroups];
    newGroups[groupIndex] = { ...newGroups[groupIndex], executionCount: count };
    setTaskGroups(newGroups);
  };

  // 添加一个新的NodeInfo到指定任务组
  const addNodeInfo = (groupIndex: number) => {
    const newGroups = [...taskGroups];
    newGroups[groupIndex].nodeInfoList.push({ nodeId: '', fieldName: '', fieldValue: '' });
    setTaskGroups(newGroups);
  };

  // 从指定任务组中移除一个NodeInfo
  const removeNodeInfo = (groupIndex: number, nodeIndex: number) => {
    const newGroups = [...taskGroups];
    if (newGroups[groupIndex].nodeInfoList.length > 1) {
      newGroups[groupIndex].nodeInfoList.splice(nodeIndex, 1);
      setTaskGroups(newGroups);
    }
  };

  // 更新指定任务组中的NodeInfo属性
  const updateNodeInfo = (groupIndex: number, nodeIndex: number, field: keyof NodeInfo, value: string) => {
    const newGroups = [...taskGroups];
    newGroups[groupIndex].nodeInfoList[nodeIndex] = { 
      ...newGroups[groupIndex].nodeInfoList[nodeIndex], 
      [field]: value 
    };
    setTaskGroups(newGroups);
  };

  // 提交表单
  const handleSubmit = (values: FormValues) => {
    const { apiKey, workflowId } = values;
    
    // 验证每个任务组，过滤掉不完整的nodeInfo
    const validTaskGroups = taskGroups.map(group => {
      return {
        ...group,
        nodeInfoList: group.nodeInfoList.filter(
          node => node.nodeId && node.fieldName && node.fieldValue !== ''
        )
      };
    }).filter(group => group.executionCount > 0);
    
    setIsSubmitting(true);
    
    // 通知父组件API Key已更改
    if (onApiKeyChange) {
      onApiKeyChange(apiKey);
    }
    
    // 遍历任务组并创建工作流
    let totalTasksCount = 0;
    validTaskGroups.forEach(group => {
      // 根据执行次数创建多个相同的工作流
      for (let i = 0; i < group.executionCount; i++) {
        // 构建请求对象
        const requestData = {
          apiKey,
          workflowId,
          // 只有当nodeInfoList不为空时才添加到请求中
          ...(group.nodeInfoList.length > 0 ? { nodeInfoList: group.nodeInfoList } : {})
        };
        
        // 使用Socket.io发送数据
        createWorkflow(requestData);
        totalTasksCount++;
      }
    });
    
    message.success(`已创建 ${totalTasksCount} 个工作流任务`);
    
    // 调用回调函数
    onSubmit();
    
    // 重置表单状态
    setTimeout(() => {
      setIsSubmitting(false);
    }, 2000);
  };

  // 监听API Key变化
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onApiKeyChange) {
      onApiKeyChange(e.target.value);
    }
  };

  // 任务组卡片标题样式
  const taskGroupTitleStyle = {
    backgroundColor: '#e6f7ff', // 浅蓝色背景
    padding: '8px 12px',
    borderRadius: '4px 4px 0 0',
    width: '100%'
  };

  // 节点卡片标题样式
  const nodeCardTitleStyle = {
    backgroundColor: '#f6ffed', // 浅绿色背景
    padding: '8px 12px',
    borderRadius: '4px 4px 0 0',
    width: '100%'
  };

  return (
    <div>
      <Title level={4} className="mb-4">创建工作流</Title>
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ apiKey: '', workflowId: '' }}
      >
        <Form.Item
          name="apiKey"
          label="API密钥"
          rules={[{ required: true, message: '请输入API密钥' }]}
        >
          <Input.Password 
            placeholder="输入API密钥" 
            onChange={handleApiKeyChange}
          />
        </Form.Item>
        
        <Form.Item
          name="workflowId"
          label="工作流ID"
          rules={[{ required: true, message: '请输入工作流ID' }]}
        >
          <Input placeholder="输入工作流ID" />
        </Form.Item>
        
        <Divider>
          <Text strong>任务组列表</Text>
        </Divider>
        
        {taskGroups.map((taskGroup, groupIndex) => (
          <Card 
            key={groupIndex} 
            size="small" 
            className="mb-4"
            headStyle={{ padding: 0, margin: 0 }}
            title={
              <div style={taskGroupTitleStyle} className="flex justify-between items-center">
                <span>任务组 #{groupIndex + 1}</span>
                {taskGroups.length > 1 && (
                  <Button 
                    danger 
                    icon={<DeleteOutlined />} 
                    size="small"
                    onClick={() => removeTaskGroup(groupIndex)}
                  />
                )}
              </div>
            }
          >
            <Row className="mb-4" align="middle">
              <Col span={18}>
                <Text strong>执行次数：</Text>
              </Col>
              <Col span={6}>
                <InputNumber
                  min={1}
                  value={taskGroup.executionCount}
                  onChange={(value) => updateExecutionCount(groupIndex, value || 1)}
                  style={{ width: '100%' }}
                />
              </Col>
            </Row>

            <Divider>
              <Text>节点信息</Text>
            </Divider>
            
            {taskGroup.nodeInfoList.map((nodeInfo, nodeIndex) => (
              <Card 
                key={nodeIndex} 
                size="small" 
                className="mb-4"
                headStyle={{ padding: 0, margin: 0 }}
                title={
                  <div style={nodeCardTitleStyle} className="flex justify-between items-center">
                    <span>节点 #{nodeIndex + 1}</span>
                    {taskGroup.nodeInfoList.length > 1 && (
                      <Button 
                        danger 
                        icon={<DeleteOutlined />} 
                        size="small"
                        onClick={() => removeNodeInfo(groupIndex, nodeIndex)}
                      />
                    )}
                  </div>
                }
              >
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Form.Item
                      label="节点ID"
                      rules={[{ required: true, message: '请输入节点ID' }]}
                    >
                      <Input
                        placeholder="节点ID"
                        value={nodeInfo.nodeId}
                        onChange={(e) => updateNodeInfo(groupIndex, nodeIndex, 'nodeId', e.target.value)}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      label="字段名称"
                      rules={[{ required: true, message: '请输入字段名称' }]}
                    >
                      <Input
                        placeholder="字段名称"
                        value={nodeInfo.fieldName}
                        onChange={(e) => updateNodeInfo(groupIndex, nodeIndex, 'fieldName', e.target.value)}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item
                      label="字段值"
                      rules={[{ required: true, message: '请输入字段值' }]}
                    >
                      <Input.TextArea
                        placeholder="字段值"
                        value={nodeInfo.fieldValue as string}
                        onChange={(e) => updateNodeInfo(groupIndex, nodeIndex, 'fieldValue', e.target.value)}
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        style={{ resize: 'vertical' }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            ))}
            
            <Divider dashed={true}>
              <Button 
                type="primary" 
                color='green'
                variant='outlined'
                icon={<PlusOutlined />} 
                onClick={() => addNodeInfo(groupIndex)} 
                size="small"
                className="mb-4"
              >
                添加节点
              </Button>
            </Divider>
          </Card>
        ))}
        
        <Divider dashed={true}>
          <Button 
            type="primary" 
            color="cyan"
            variant='outlined'
            icon={<PlusOutlined />} 
            onClick={addTaskGroup} 
            size="small"
            className="mb-4"
          >
            添加任务组
          </Button>
        </Divider>
        
        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? '提交中...' : '创建工作流'}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
} 