import { useState } from 'react';
import { NodeInfo } from '../types';
import { createWorkflow } from '../services/socket';
import { Form, Input, Button, Card, Typography, Row, Col, Divider, Space, message } from 'antd';
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

export default function WorkflowForm({ onSubmit, onApiKeyChange }: WorkflowFormProps) {
  const [form] = Form.useForm();
  const [nodeInfoList, setNodeInfoList] = useState<NodeInfo[]>([
    { nodeId: '', fieldName: '', fieldValue: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    
    // 通知父组件API Key已更改
    if (onApiKeyChange) {
      onApiKeyChange(apiKey);
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

  // 监听API Key变化
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onApiKeyChange) {
      onApiKeyChange(e.target.value);
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
                    danger 
                    icon={<DeleteOutlined />} 
                    size="small"
                    onClick={() => removeNodeInfo(index)}
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
                    onChange={(e) => updateNodeInfo(index, 'nodeId', e.target.value)}
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
                    onChange={(e) => updateNodeInfo(index, 'fieldName', e.target.value)}
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
                    onChange={(e) => updateNodeInfo(index, 'fieldValue', e.target.value)}
                    autoSize={{ minRows: 1, maxRows: 6 }}
                    style={{ resize: 'vertical' }}
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