import { useState, useEffect } from 'react'
import './App.css'
import WorkflowForm from './components/WorkflowForm'
import PollingTaskList from './components/PollingTaskList'
import ConnectionStatus from './components/ConnectionStatus'
import { WorkflowTask, TaskStatus, PollingTaskResult } from './types'
import { 
  onWorkflowCreated, 
  onWorkflowError, 
  clearAllListeners 
} from './services/socket'
import { 
  pollingEvents, 
  onPollingEvent, 
  clearAllPollingListeners,
  startPolling 
} from './services/taskPolling'
import { Layout, Typography, Row, Col, Card, message, ConfigProvider, theme, Tabs } from 'antd'

const { Header, Content, Footer } = Layout
const { Title } = Typography
const { TabPane } = Tabs

function App() {
  const [tasks, setTasks] = useState<WorkflowTask[]>([])
  const [messageApi, contextHolder] = message.useMessage();
  const [apiKey, setApiKey] = useState<string>('');
  // 跟踪正在轮询的任务列表
  const [pollingTasks, setPollingTasks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // 当工作流创建成功时
    const handleWorkflowCreated = (task: WorkflowTask) => {
      setTasks(prevTasks => [task, ...prevTasks]);
      messageApi.success('工作流创建成功！');
      
      // 如果有API Key，自动开始轮询
      if (apiKey) {
        console.log(`自动开始轮询任务 ${task.taskId}`);
        startPolling(apiKey, task.taskId);
        setPollingTasks(prev => ({ ...prev, [task.taskId]: true }));
      }
    }

    // 当工作流创建失败时
    const handleWorkflowError = (error: { error: string }) => {
      console.error('工作流创建失败:', error)
      messageApi.error(`工作流创建失败: ${error.error}`);
    }

    // 处理轮询任务状态更新
    const handleTaskStatusUpdate = (data: PollingTaskResult) => {
      const { taskId, status } = data;
      
      console.log('轮询任务状态更新:', taskId, status);
      
      setTasks(prevTasks => {
        return prevTasks.map(task => {
          if (task.taskId === taskId) {
            return {
              ...task,
              status,
            };
          }
          return task;
        });
      });
    };
    
    // 处理轮询任务输出结果更新
    const handleTaskOutputsUpdate = (data: PollingTaskResult) => {
      const { taskId, outputs } = data;
      
      console.log('轮询任务输出结果:', taskId, outputs);
      
      if (!outputs) return;
      
      setTasks(prevTasks => {
        return prevTasks.map(task => {
          if (task.taskId === taskId) {
            return {
              ...task,
              status: TaskStatus.SUCCESS,
              result: { data: outputs } as Record<string, unknown>,
              completedAt: new Date().toISOString()
            };
          }
          return task;
        });
      });
      
      // 任务完成，更新轮询状态
      setPollingTasks(prev => ({ ...prev, [taskId]: false }));
      messageApi.success(`轮询到任务 ${taskId} 已完成`);
    };
    
    // 处理轮询任务错误
    const handleTaskError = (data: PollingTaskResult) => {
      const { taskId, error } = data;
      
      console.error('轮询任务错误:', taskId, error);
      
      setTasks(prevTasks => {
        return prevTasks.map(task => {
          if (task.taskId === taskId) {
            return {
              ...task,
              status: TaskStatus.FAILED,
              error,
              completedAt: new Date().toISOString()
            };
          }
          return task;
        });
      });
      
      // 任务失败，更新轮询状态
      setPollingTasks(prev => ({ ...prev, [taskId]: false }));
      messageApi.error(`轮询任务 ${taskId} 失败: ${error}`);
    };

    // 注册事件监听
    onWorkflowCreated(handleWorkflowCreated);
    onWorkflowError(handleWorkflowError);
    
    // 注册轮询事件监听
    onPollingEvent(pollingEvents.taskStatusUpdate, handleTaskStatusUpdate);
    onPollingEvent(pollingEvents.taskOutputsUpdate, handleTaskOutputsUpdate);
    onPollingEvent(pollingEvents.taskError, handleTaskError);

    // 组件卸载时清除所有监听
    return () => {
      clearAllListeners();
      clearAllPollingListeners();
    }
  }, [messageApi, apiKey]);

  // 处理表单提交
  const handleFormSubmit = () => {
    console.log('工作流提交成功');
  }
  
  // 处理API Key变化
  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey);
  };
  
  // 处理轮询状态变化
  const handlePollingStatusChange = (taskId: string, isPolling: boolean) => {
    setPollingTasks(prev => ({ ...prev, [taskId]: isPolling }));
  };

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
                  <WorkflowForm 
                    onSubmit={handleFormSubmit} 
                    onApiKeyChange={handleApiKeyChange}
                  />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card bordered={false} style={{ height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
                  <Tabs defaultActiveKey="polling">
                    <TabPane tab="任务结果" key="polling">
                      <PollingTaskList 
                        tasks={tasks} 
                        apiKey={apiKey} 
                        loadingTasks={pollingTasks}
                        onPollingStatusChange={handlePollingStatusChange}
                      />
                    </TabPane>
                  </Tabs>
                </Card>
              </Col>
            </Row>
          </div>
        </Content>
        
        <Footer style={{ textAlign: 'center', background: '#f0f2f5' }}>
          RunningHub 工作流自动运行 ©{new Date().getFullYear()} Created by RunningHub Team
        </Footer>
      </Layout>
    </ConfigProvider>
  )
}

export default App
