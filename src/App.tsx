import { useState, useEffect } from 'react'
import './App.css'
import WorkflowForm from './components/WorkflowForm'
import PollingTaskList from './components/PollingTaskList'
import ConnectionStatus from './components/ConnectionStatus'
import { WorkflowTask, TaskStatus, PollingTaskResult } from './types'
import { 
  onWorkflowCreated, 
  onWorkflowError,
  onWorkflowStatusUpdate,
  clearAllListeners,
  socket,
  socketEvents,
  notifyDeleteTask,
  requestClientTasks,
  onClientTasks,
  WorkflowStatusUpdate
} from './services/socket'
import { 
  pollingEvents, 
  onPollingEvent, 
  clearAllPollingListeners,
  startPolling 
} from './services/taskPolling'
import { Layout, Typography, Row, Col, Card, message, ConfigProvider, theme } from 'antd'
import { cancelTask } from './services/taskService'
import { useClientStore } from './stores/clientStore'

const { Header, Content, Footer } = Layout
const { Title } = Typography

function App() {
  const [tasks, setTasks] = useState<WorkflowTask[]>([])
  const [messageApi, contextHolder] = message.useMessage();
  const [apiKey, setApiKey] = useState<string>('');
  // 跟踪正在轮询的任务列表
  const [pollingTasks, setPollingTasks] = useState<Record<string, boolean>>({});
  // 获取客户端ID
  const { clientId, init: initClientId, initialized } = useClientStore();

  // 初始化客户端ID
  useEffect(() => {
    initClientId();
  }, [initClientId]);

  // 当客户端ID初始化完成后，请求加载任务列表
  useEffect(() => {
    if (initialized && clientId) {
      console.log('客户端ID初始化完成，请求任务列表:', clientId);
      requestClientTasks(clientId);
    }
  }, [initialized, clientId]);

  useEffect(() => {
    // 当工作流创建成功时
    const handleWorkflowCreated = (task: WorkflowTask) => {
      setTasks(prevTasks => [task, ...prevTasks]);
      
      // 根据任务状态显示不同的消息
      if (task.status === 'WAITING' || task.status === TaskStatus.WAITING) {
        messageApi.info('工作流已加入等待队列！');
      } else {
        messageApi.success('工作流创建成功！');
        
        // 只有非WAITING状态且有有效taskId的任务才自动开始轮询
        if (apiKey && task.taskId && 
            task.status !== 'WAITING' && 
            task.status !== TaskStatus.WAITING) {
          console.log(`自动开始轮询任务 ${task.taskId}`);
          startPolling(apiKey, task.taskId);
          setPollingTasks(prev => ({ ...prev, [task.taskId]: true }));
        }
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
    
    // 处理客户端任务列表
    const handleClientTasks = (data: { clientId: string, tasks: WorkflowTask[], error?: string }) => {
      console.log('收到客户端任务列表:', data);
      
      if (data.error) {
        messageApi.error(`获取任务列表失败: ${data.error}`);
        return;
      }
      
      if (data.tasks && Array.isArray(data.tasks)) {
        // 更新任务列表 - 保留现有内存中的任务，添加新的任务
        setTasks(prevTasks => {
          // 找出所有已有的任务ID
          const existingTaskIds = new Set(prevTasks.map(t => t.taskId));
          
          // 过滤出不在现有列表中的任务
          const newTasks = data.tasks.filter(task => {
            // 对于没有taskId的任务(WAITING状态)，使用createdAt作为唯一标识
            if (!task.taskId) {
              return !prevTasks.some(t => t.createdAt === task.createdAt);
            }
            // 对于有taskId的任务，检查是否已存在
            return !existingTaskIds.has(task.taskId);
          });
          
          // 对于正在运行的任务，开始轮询
          newTasks.forEach(task => {
            if (apiKey && task.taskId && 
                task.status !== 'WAITING' && 
                task.status !== TaskStatus.WAITING && 
                task.status !== 'SUCCESS' && 
                task.status !== TaskStatus.SUCCESS && 
                task.status !== 'FAILED' && 
                task.status !== TaskStatus.FAILED) {
              console.log(`自动开始轮询任务 ${task.taskId}`);
              startPolling(apiKey, task.taskId);
              setPollingTasks(prev => ({ ...prev, [task.taskId]: true }));
            }
          });
          
          // 合并任务列表，新的任务添加到列表前面
          return [...newTasks, ...prevTasks];
        });
      }
    };

    // 注册事件监听
    onWorkflowCreated(handleWorkflowCreated);
    onWorkflowError(handleWorkflowError);
    onClientTasks(handleClientTasks);
    
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

  // 在App.tsx中修改socket事件监听
  useEffect(() => {
    // 当工作流状态更新时（针对WAITING转为其他状态）
    const handleWorkflowStatusUpdate = (data: WorkflowStatusUpdate) => {
      console.log('收到任务状态更新:', data);
      
      setTasks(prevTasks => {
        return prevTasks.map(task => {
          // 根据原始创建时间匹配任务
          if (task.createdAt === data.originalCreatedAt) {
            // 更新任务状态和ID，保留nodeInfoList和其他属性
            return {
              ...task,
              taskId: data.taskId,
              status: data.status,
              // 保留原始创建时间
              createdAt: task.createdAt
            };
          }
          return task;
        });
      });
      
      // 只有当任务不是WAITING状态且有有效taskId时才开始轮询
      if (data.taskId && apiKey && 
          data.status !== 'WAITING' && 
          data.status !== TaskStatus.WAITING) {
        startPolling(apiKey, data.taskId);
        setPollingTasks(prev => ({ ...prev, [data.taskId]: true }));
        messageApi.success('等待中的任务已开始执行！');
      }
    };

    // 添加事件监听
    onWorkflowStatusUpdate(handleWorkflowStatusUpdate);
    
    // 清理函数
    return () => {
      socket.off(socketEvents.workflowStatusUpdate, handleWorkflowStatusUpdate);
    };
  }, [apiKey]);

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

  // 修改删除任务的处理函数
  const handleDeleteTask = async (taskIdOrUniqueId: string, isUniqueId: boolean = false) => {
    // 对于有taskId的任务，停止轮询
    if (!isUniqueId && taskIdOrUniqueId) {
      setPollingTasks(prev => {
        const newPollingTasks = { ...prev };
        delete newPollingTasks[taskIdOrUniqueId];
        return newPollingTasks;
      });
    }
    
    // 从任务列表中移除任务
    setTasks(prevTasks => {
      // 查找要删除的任务，以获取完整信息
      const taskToDelete = prevTasks.find(task => {
        if (isUniqueId) {
          // 使用组件生成的uniqueId删除任务（主要用于WAITING状态的任务）
          const taskUniqueId = task.taskId || `waiting-task-${prevTasks.indexOf(task)}`;
          return taskUniqueId === taskIdOrUniqueId;
        } else {
          // 使用taskId删除任务（适用于非WAITING状态的任务）
          return task.taskId === taskIdOrUniqueId;
        }
      });
      
      // 如果找到任务，根据状态执行不同的操作
      if (taskToDelete) {
        // 检查任务状态
        const status = taskToDelete.status;
        const taskId = taskToDelete.taskId;
        
        // WAITING状态的任务需要通知服务器从等待队列中删除
        if (status === 'WAITING' || status === TaskStatus.WAITING) {
          // 通知服务器从等待队列中删除任务
          notifyDeleteTask(
            taskIdOrUniqueId,  // uniqueId
            taskToDelete.taskId || null, // taskId
            taskToDelete.createdAt, // createdAt
            true // isWaiting
          );
        } 
        // QUEUED或PENDING状态的任务需要调用API取消任务执行
        else if ((status === 'QUEUED' || status === TaskStatus.QUEUED || 
                 status === 'RUNNING' || status === TaskStatus.RUNNING) && 
                 taskId) {
          // 调用取消任务API
          cancelTask(apiKey, taskId)
            .then(success => {
              if (success) {
                messageApi.success(`已成功取消任务 ${taskId}`);
              } else {
                messageApi.error(`取消任务 ${taskId} 失败`);
              }
            })
            .catch(error => {
              messageApi.error(`取消任务出错: ${error.message}`);
            });
        }
      }
      
      // 过滤掉要删除的任务
      return prevTasks.filter(task => {
        if (isUniqueId) {
          const taskUniqueId = task.taskId || `waiting-task-${prevTasks.indexOf(task)}`;
          return taskUniqueId !== taskIdOrUniqueId;
        } else {
          return task.taskId !== taskIdOrUniqueId;
        }
      });
    });
    
    messageApi.success('任务已从列表中删除');
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
                  <PollingTaskList 
                    tasks={tasks} 
                    apiKey={apiKey} 
                    loadingTasks={pollingTasks}
                    onPollingStatusChange={handlePollingStatusChange}
                    onDeleteTask={(taskIdOrUniqueId, isUniqueId, task) => handleDeleteTask(taskIdOrUniqueId, isUniqueId)}
                  />
                </Card>
              </Col>
            </Row>
          </div>
        </Content>
        
        <Footer style={{ textAlign: 'center', background: '#f0f2f5' }}>
          RunningHub 工作流自动运行 ©{new Date().getFullYear()} Created by 北京善小为科技有限公司
        </Footer>
      </Layout>
    </ConfigProvider>
  )
}

export default App
