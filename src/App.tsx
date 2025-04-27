import { useState, useEffect } from 'react'
import './App.css'
import WorkflowForm from './components/WorkflowForm'
import TaskList from './components/TaskList'
import ConnectionStatus from './components/ConnectionStatus'
import { WorkflowTask, TaskStatus, WebhookCallbackData } from './types'
import { 
  onWorkflowCreated, 
  onWorkflowError, 
  onWebhookCallback, 
  clearAllListeners 
} from './services/socket'
import { Layout, Typography, Row, Col, Card, message, ConfigProvider, theme } from 'antd'

const { Header, Content, Footer } = Layout
const { Title } = Typography

function App() {
  const [tasks, setTasks] = useState<WorkflowTask[]>([])
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    // 当工作流创建成功时
    const handleWorkflowCreated = (task: WorkflowTask) => {
      setTasks(prevTasks => [task, ...prevTasks])
      messageApi.success('工作流创建成功！');
    }

    // 当工作流创建失败时
    const handleWorkflowError = (error: { error: string }) => {
      console.error('工作流创建失败:', error)
      messageApi.error(`工作流创建失败: ${error.error}`);
    }

    // 当收到webhook回调时
    const handleWebhookCallback = (data: WebhookCallbackData) => {
      const { taskId, event, data: eventData } = data
      
      console.log('收到Webhook回调:', event, taskId);
      console.log('Webhook事件数据:', eventData);
      
      // 支持任何事件类型进行任务状态更新
      try {
        // 尝试解析eventData
        const parsedData = typeof eventData === 'string' 
          ? JSON.parse(eventData) 
          : eventData;
        
        console.log('解析后的Webhook数据:', parsedData);
        
        // 无论事件类型如何，都尝试更新任务状态
        setTasks(prevTasks => {
          return prevTasks.map(task => {
            if (task.taskId === taskId) {
              // 根据事件类型更新任务状态
              let newStatus = task.status;
              if (event === 'TASK_END') {
                newStatus = TaskStatus.SUCCESS;
                messageApi.success(`任务 ${taskId} 已完成`);
              } else if (event.includes('ERROR') || event.includes('FAIL')) {
                newStatus = TaskStatus.FAILED;
                messageApi.error(`任务 ${taskId} 失败`);
              }
              
              return {
                ...task,
                status: newStatus,
                result: parsedData,
                completedAt: new Date().toISOString()
              }
            }
            return task
          })
        })
      } catch (error) {
        console.error('解析webhook数据失败:', error);
        messageApi.error('解析webhook数据失败');
      }
    }

    // 注册事件监听
    onWorkflowCreated(handleWorkflowCreated)
    onWorkflowError(handleWorkflowError)
    onWebhookCallback(handleWebhookCallback)

    // 组件卸载时清除所有监听
    return () => {
      clearAllListeners()
    }
  }, [messageApi])

  // 处理表单提交
  const handleFormSubmit = () => {
    console.log('工作流提交成功')
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
        },
      }}
    >
      {contextHolder}
      <Layout style={{ minHeight: '100vh', width: '100%' }}>
        <Header style={{ background: '#fff', padding: 0, width: '100%', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
            <Title level={3} style={{ margin: 0, color: '#1677ff' }}>RunningHub 工作流自动运行</Title>
            <ConnectionStatus />
          </div>
        </Header>
        
        <Content style={{ padding: '24px 0', width: '100%' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 16px' }}>
            <Row gutter={[24, 24]}>
              <Col xs={24} lg={12}>
                <Card bordered={false} style={{ height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
                  <WorkflowForm onSubmit={handleFormSubmit} />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card bordered={false} style={{ height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
                  <TaskList tasks={tasks} />
                </Card>
              </Col>
            </Row>
          </div>
        </Content>
        
        <Footer style={{ textAlign: 'center', background: '#f7f7f7' }}>
          RunningHub 工作流自动运行系统 ©{new Date().getFullYear()} 版权所有
        </Footer>
      </Layout>
    </ConfigProvider>
  )
}

export default App
