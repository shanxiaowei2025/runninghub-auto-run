import { useEffect, useState } from 'react';
import { createWorkflow } from '../services/socket';
import { Form, Input, Button, Card, Typography, Row, Col, Divider, message, InputNumber } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useWorkflowFormStore } from '../stores/workflowFormStore';
import { useClientStore } from '../stores/clientStore';

const { Title, Text } = Typography;

interface WorkflowFormProps {
  onSubmit: () => void;
  onApiKeyChange?: (apiKey: string) => void;
}

interface FormValues {
  apiKey: string;
  workflowId: string;
}

export default function WorkflowForm({ onSubmit, onApiKeyChange }: WorkflowFormProps) {
  const [form] = Form.useForm<FormValues>();
  // 使用 Zustand store 中的状态和方法
  const { 
    formData,
    setApiKey,
    setWorkflowId,
    addTaskGroup, 
    removeTaskGroup,
    updateExecutionCount,
    addNodeInfo,
    removeNodeInfo,
    updateNodeInfo
  } = useWorkflowFormStore();
  
  const taskGroups = formData.taskGroups;
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 获取客户端ID
  const { clientId } = useClientStore();
  
  // 初始化表单数据
  useEffect(() => {
    form.setFieldsValue({
      apiKey: formData.apiKey,
      workflowId: formData.workflowId
    });
    
    // 如果已有API Key，通知父组件
    if (formData.apiKey && onApiKeyChange) {
      onApiKeyChange(formData.apiKey);
    }
  }, [form, formData.apiKey, formData.workflowId, onApiKeyChange]);

  // 处理单个任务组提交
  const handleSubmitSingleGroup = (groupIndex: number) => {
    // 获取表单当前值
    const formValues = form.getFieldsValue();
    const { apiKey, workflowId } = formValues;
    
    if (!apiKey || !workflowId) {
      message.error('请先填写API密钥和工作流ID');
      return;
    }
    
    // 验证当前任务组，过滤掉不完整的nodeInfo
    const group = taskGroups[groupIndex];
    const validNodeInfoList = group.nodeInfoList.filter(
      node => node.nodeId && node.fieldName && node.fieldValue !== ''
    );
    
    // 允许空的 nodeInfoList
    setIsSubmitting(true);
    
    // 保存API Key和workflowId到store
    setApiKey(apiKey);
    setWorkflowId(workflowId);
    
    // 通知父组件API Key已更改
    if (onApiKeyChange) {
      onApiKeyChange(apiKey);
    }
    
    // 创建工作流任务
    let tasksCount = 0;
    for (let i = 0; i < group.executionCount; i++) {
      // 构建请求对象
      const requestData = {
        apiKey,
        workflowId,
        nodeInfoList: validNodeInfoList,
        clientId: clientId || undefined,
        _timestamp: new Date().toISOString()
      };
      
      // 使用Socket.io发送数据
      createWorkflow(requestData);
      tasksCount++;
    }
    
    message.success(`已创建 ${tasksCount} 个工作流任务`);
    
    // 调用回调函数
    onSubmit();
    
    // 重置表单状态
    setTimeout(() => {
      setIsSubmitting(false);
    }, 2000);
  };

  // 提交表单
  const handleSubmit = () => {
    if (!formData.apiKey) {
      message.error('API Key 不能为空');
      return;
    }
    
    if (!formData.workflowId) {
      message.error('工作流ID不能为空');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      let totalTasksCreated = 0;
      
      // 处理任务组
      taskGroups.forEach((group) => {
        // 验证当前任务组，过滤掉不完整的nodeInfo
        const validNodeInfoList = group.nodeInfoList.filter(
          node => node.nodeId && node.fieldName && node.fieldValue !== ''
        );
        
        // 每个任务组执行多次
        for (let i = 0; i < group.executionCount; i++) {
          // 构建请求对象
          const requestData = {
            apiKey: formData.apiKey,
            workflowId: formData.workflowId,
            nodeInfoList: validNodeInfoList.map(nodeInfo => ({
              ...nodeInfo,
              // 如果有多次执行，且jsonFile存在，则生成不同的jsonFile路径
              jsonFile: nodeInfo.jsonFile && group.executionCount > 1 
                ? `${nodeInfo.jsonFile.replace('.json', '')}_${i + 1}.json`
                : nodeInfo.jsonFile
            })),
            clientId: clientId || undefined,
            _timestamp: new Date().toISOString(),
          };
          
          // 调用 createWorkflow 接口
          createWorkflow(requestData);
          totalTasksCreated++;
        }
      });
      
      // 显示成功消息
      message.success(`已成功创建 ${totalTasksCreated} 个工作流任务`);
      
      // 执行回调
      if (onSubmit) {
        onSubmit();
      }
    } catch (error) {
      console.error('创建工作流时出错:', error);
      message.error('创建工作流时出错');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 监听API Key变化
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    
    if (onApiKeyChange) {
      onApiKeyChange(value);
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
        initialValues={{ 
          apiKey: formData.apiKey, 
          workflowId: formData.workflowId 
        }}
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
          <Input 
            placeholder="输入工作流ID" 
            onChange={(e) => setWorkflowId(e.target.value)}
          />
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
            
            {taskGroup.nodeInfoList.length === 0 ? (
              <div className="text-center py-4">
                <Text type="secondary">当前没有节点信息</Text>
              </div>
            ) : (
              taskGroup.nodeInfoList.map((nodeInfo, nodeIndex) => (
                <Card 
                  key={nodeIndex} 
                  size="small" 
                  className="mb-4"
                  headStyle={{ padding: 0, margin: 0 }}
                  title={
                    <div style={nodeCardTitleStyle} className="flex justify-between items-center">
                      <span>节点 #{nodeIndex + 1}</span>
                      <Button 
                        danger 
                        icon={<DeleteOutlined />} 
                        size="small"
                        onClick={() => removeNodeInfo(groupIndex, nodeIndex)}
                      />
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
              ))
            )}
            
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
            
            {/* 添加单个任务组的创建工作流按钮 */}
            <div className="text-center mt-4">
              <Button
                type="primary"
                onClick={() => handleSubmitSingleGroup(groupIndex)}
                loading={isSubmitting}
                style={{ backgroundColor: '#1890ff' }}
              >
                创建此任务组工作流
              </Button>
            </div>
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
            {isSubmitting ? '提交中...' : '创建所有任务组工作流'}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
} 