import { useState } from 'react';
import { NodeInfo } from '../types';
import { createWorkflow } from '../services/socket';
import { Form, Input, Button, Card, Typography, Row, Col, Divider, Space, message, Switch } from 'antd';
import { PlusOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Title, Text } = Typography;

interface WorkflowFormProps {
  onSubmit: () => void;
}

interface FormValues {
  apiKey: string;
  workflowId: string;
}

export default function WorkflowForm({ onSubmit }: WorkflowFormProps) {
  const [form] = Form.useForm();
  const [nodeInfoList, setNodeInfoList] = useState<NodeInfo[]>([
    { nodeId: '', fieldName: '', fieldValue: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 添加自定义webhook开关状态
  const [useCustomWebhook, setUseCustomWebhook] = useState(false);
  // 添加自定义webhook URL
  const [customWebhookUrl, setCustomWebhookUrl] = useState('');
  // 添加测试webhook功能状态
  const [testTaskId, setTestTaskId] = useState('test-task-id');
  const [isTesting, setIsTesting] = useState(false);

  // 添加一个新的NodeInfo
  const addNodeInfo = () => {
    setNodeInfoList([...nodeInfoList, { nodeId: '', fieldName: '', fieldValue: '' }]);
  };

  // 移除一个NodeInfo
  const removeNodeInfo = (index: number) => {
    if (nodeInfoList.length > 1) {
      const newList = [...nodeInfoList];
      newList.splice(index, 1);
      setNodeInfoList(newList);
    }
  };

  // 更新NodeInfo属性
  const updateNodeInfo = (index: number, field: keyof NodeInfo, value: string) => {
    const newList = [...nodeInfoList];
    newList[index] = { ...newList[index], [field]: value };
    setNodeInfoList(newList);
  };

  // 提交表单
  const handleSubmit = (values: FormValues) => {
    const { apiKey, workflowId } = values;
    
    // 过滤掉不完整的nodeInfo
    const filteredNodeInfoList = nodeInfoList.filter(
      node => node.nodeId && node.fieldName && node.fieldValue !== ''
    );
    
    if (filteredNodeInfoList.length === 0) {
      message.error('请至少添加一个有效的节点信息');
      return;
    }
    
    setIsSubmitting(true);
    
    // 构建请求对象
    const requestData = {
      apiKey,
      workflowId,
      nodeInfoList: filteredNodeInfoList
    };
    
    // 如果使用自定义webhook URL，则添加到请求中
    if (useCustomWebhook && customWebhookUrl) {
      Object.assign(requestData, { webhookUrl: customWebhookUrl });
    }
    
    // 使用Socket.io发送数据
    createWorkflow(requestData);
    
    // 调用回调函数
    onSubmit();
    
    // 重置表单状态
    setTimeout(() => {
      setIsSubmitting(false);
    }, 2000);
  };

  // 测试webhook回调
  const testWebhook = async () => {
    // 确保WebhookURL不为空
    if (!customWebhookUrl && !useCustomWebhook) {
      message.warning('请先启用并设置自定义Webhook URL');
      return;
    }

    const url = useCustomWebhook && customWebhookUrl 
      ? customWebhookUrl 
      : `http://localhost:5173/api/webhook/${Date.now()}`;
    
    setIsTesting(true);
    
    try {
      const response = await axios.post(url, {
        event: 'TASK_END',
        taskId: testTaskId,
        eventData: JSON.stringify({
          code: 0,
          msg: 'success',
          data: [{
            fileUrl: 'https://example.com/test-image.png',
            fileType: 'png',
            taskCostTime: 2000,
            nodeId: '9'
          }]
        })
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('测试webhook响应:', response.data);
      message.success('测试webhook回调成功');
    } catch (error) {
      console.error('测试webhook回调失败:', error);
      message.error('测试webhook回调失败，请查看控制台');
    } finally {
      setIsTesting(false);
    }
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
          <Input.Password placeholder="输入API密钥" />
        </Form.Item>
        
        <Form.Item
          name="workflowId"
          label="工作流ID"
          rules={[{ required: true, message: '请输入工作流ID' }]}
        >
          <Input placeholder="输入工作流ID" />
        </Form.Item>
        
        {/* 添加自定义webhook URL选项 */}
        <Form.Item label="使用自定义Webhook URL">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Switch 
              checked={useCustomWebhook} 
              onChange={(checked) => setUseCustomWebhook(checked)} 
            />
            <span style={{ marginLeft: '8px' }}>
              {useCustomWebhook ? '开启' : '关闭'}
            </span>
            
            {useCustomWebhook && (
              <Button 
                type="link" 
                icon={<ApiOutlined />}
                loading={isTesting}
                onClick={testWebhook}
                style={{ marginLeft: 'auto' }}
              >
                测试Webhook
              </Button>
            )}
          </div>
        </Form.Item>
        
        {useCustomWebhook && (
          <>
            <Form.Item
              label="自定义Webhook URL"
              rules={[{ required: useCustomWebhook, message: '请输入自定义Webhook URL' }]}
            >
              <Input
                value={customWebhookUrl}
                onChange={(e) => setCustomWebhookUrl(e.target.value)}
                placeholder="https://your-webhook-url"
              />
            </Form.Item>
            
            <Form.Item label="测试任务ID">
              <Input
                value={testTaskId}
                onChange={(e) => setTestTaskId(e.target.value)}
                placeholder="用于测试Webhook的任务ID"
              />
            </Form.Item>
          </>
        )}
        
        <Divider>
          <Space>
            <Text strong>节点信息</Text>
            <Button 
              type="primary" 
              icon={<PlusOutlined />} 
              onClick={addNodeInfo} 
              size="small"
            >
              添加节点
            </Button>
          </Space>
        </Divider>
        
        {nodeInfoList.map((nodeInfo, index) => (
          <Card 
            key={index} 
            size="small" 
            className="mb-4"
            title={
              <div className="flex justify-between items-center">
                <span>节点 #{index + 1}</span>
                {nodeInfoList.length > 1 && (
                  <Button 
                    type="text" 
                    danger 
                    icon={<DeleteOutlined />} 
                    onClick={() => removeNodeInfo(index)} 
                    size="small"
                  />
                )}
              </div>
            }
          >
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item label="节点ID" required>
                  <Input
                    value={nodeInfo.nodeId}
                    onChange={(e) => updateNodeInfo(index, 'nodeId', e.target.value)}
                    placeholder="如: 6"
                  />
                </Form.Item>
              </Col>
              
              <Col xs={24} md={8}>
                <Form.Item label="字段名称" required>
                  <Input
                    value={nodeInfo.fieldName}
                    onChange={(e) => updateNodeInfo(index, 'fieldName', e.target.value)}
                    placeholder="如: text"
                  />
                </Form.Item>
              </Col>
              
              <Col xs={24} md={8}>
                <Form.Item label="字段值" required>
                  <Input
                    value={nodeInfo.fieldValue.toString()}
                    onChange={(e) => updateNodeInfo(index, 'fieldValue', e.target.value)}
                    placeholder="如: 1 girl in classroom"
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        ))}
        
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