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
  onConnect,
  onTaskRecoveryUpdate,
  WorkflowStatusUpdate,
  TaskRecoveryUpdate,
  onTaskProcessingCompleted
} from './services/socket'
import { 
  pollingEvents, 
  onPollingEvent, 
  clearAllPollingListeners,
  startPolling
} from './services/taskPolling'
import { onTaskCompleted } from './services/waitingTaskQueue'
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

  // 监听Socket连接恢复事件
  useEffect(() => {
    const handleSocketConnect = () => {
      console.log('Socket连接已恢复，clientId:', clientId);
      if (clientId) {
        console.log('重新请求客户端任务列表');
        // 连接恢复后，请求加载任务列表，服务端会自动将WAITING任务重新加入队列
        requestClientTasks(clientId);
      }
    };

    // 注册socket连接事件
    onConnect(handleSocketConnect);

    return () => {
      // 移除事件监听
      socket.off(socketEvents.connect, handleSocketConnect);
    };
  }, [clientId]);

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
      // 将新任务添加到任务列表，并且在新任务创建后重新请求完整的任务列表
      setTasks(prevTasks => [task, ...prevTasks]);
      
      // 如果有clientId，请求更新任务列表以保持正确排序
      if (clientId) {
        requestClientTasks(clientId);
      }
      
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
          setPollingTasks(prev => ({ ...prev, [task.taskId as string]: true }));
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
    
    // 任务完成时检查等待队列
    const handleTaskCompleted = (taskId: string) => {
      console.log(`任务 ${taskId} 已完成，检查等待队列...`);
      
      // 查找完成的任务，获取其taskInterval
      const completedTask = tasks.find(task => task.taskId === taskId);
      const taskInterval = completedTask?.taskInterval as number | undefined;
      
      // 通知等待队列服务处理下一个任务，传递间隔时间
      onTaskCompleted(taskInterval);
      
      // 任务完成，更新轮询状态
      setPollingTasks(prev => {
        const newPollingTasks = { ...prev };
        delete newPollingTasks[taskId];
        return newPollingTasks;
      });
    };
    
    // 处理轮询任务输出结果更新
    const handleTaskOutputsUpdate = (data: PollingTaskResult) => {
      const { taskId, outputs } = data;
      
      console.log('轮询任务输出结果:', taskId, outputs);
      
      if (!outputs) return;
      
      // 查找任务获取其taskInterval
      const currentTask = tasks.find(task => task.taskId === taskId);
      const taskInterval = currentTask?.taskInterval as number | undefined;
      
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
      setPollingTasks(prev => ({ ...prev, [taskId as string]: false }));
      messageApi.success(`轮询到任务 ${taskId} 已完成`);
      
      // 任务完成后，尝试处理等待队列中的任务，传递间隔时间
      onTaskCompleted(taskInterval);
      
      // 请求完整任务列表以保持正确排序
      if (clientId) {
        requestClientTasks(clientId);
      }
    };
    
    // 处理轮询任务错误
    const handleTaskError = (data: PollingTaskResult) => {
      const { taskId, error } = data;
      
      console.error('轮询任务错误:', taskId, error);
      
      // 查找任务获取其taskInterval
      const currentTask = tasks.find(task => task.taskId === taskId);
      const taskInterval = currentTask?.taskInterval as number | undefined;
      
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
      setPollingTasks(prev => ({ ...prev, [taskId as string]: false }));
      messageApi.error(`轮询任务 ${taskId} 失败: ${error}`);
      
      // 任务完成后（即使是失败），尝试处理等待队列中的任务，传递间隔时间
      onTaskCompleted(taskInterval);
      
      // 请求完整任务列表以保持正确排序
      if (clientId) {
        requestClientTasks(clientId);
      }
    };
    
    // 处理客户端任务列表
    const handleClientTasks = (data: { clientId: string, tasks: WorkflowTask[], error?: string }) => {
      console.log('收到客户端任务列表:', data);
      
      if (data.error) {
        messageApi.error(`获取任务列表失败: ${data.error}`);
        return;
      }
      
      if (data.tasks && Array.isArray(data.tasks)) {
        // 直接使用服务器返回的已排序任务列表，不再手动合并
        setTasks(data.tasks);
        
        // 对于正在运行的任务，开始轮询
        data.tasks.forEach(task => {
          if (apiKey && task.taskId && 
              task.status !== 'WAITING' && 
              task.status !== TaskStatus.WAITING && 
              task.status !== 'SUCCESS' && 
              task.status !== TaskStatus.SUCCESS && 
              task.status !== 'FAILED' && 
              task.status !== TaskStatus.FAILED) {
            console.log(`自动开始轮询任务 ${task.taskId}`);
            startPolling(apiKey, task.taskId);
            setPollingTasks(prev => ({ ...prev, [task.taskId as string]: true }));
          }
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

    // 订阅任务完成事件
    socket.on(socketEvents.taskCompleted, handleTaskCompleted);

    // 组件卸载时清除所有监听
    return () => {
      clearAllListeners();
      clearAllPollingListeners();
      socket.off(socketEvents.taskCompleted, handleTaskCompleted);
    }
  }, [messageApi, apiKey]);

  // 在App.tsx中修改socket事件监听
  useEffect(() => {
    // 当工作流状态更新时（针对WAITING转为其他状态）
    const handleWorkflowStatusUpdate = (data: WorkflowStatusUpdate) => {
      console.log('收到任务状态更新:', data);
      
      // 被恢复的任务应该根据clientId和uniqueId来匹配
      const isRecoveredTask = 'recovered' in data && data.recovered === true;
      
      setTasks(prevTasks => {
        return prevTasks.map(task => {
          // 如果是恢复的任务，需要匹配clientId和uniqueId
          if (isRecoveredTask && 'clientId' in data) {
            if (task.clientId === data.clientId && task.uniqueId === data.uniqueId) {
              // 更新恢复任务的状态
              return {
                ...task,
                taskId: data.taskId,
                status: data.status,
                createdAt: task.createdAt // 保留原始创建时间
              };
            }
          } 
          // 使用uniqueId而不是createdAt匹配任务
          else if (task.uniqueId === data.uniqueId) {
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
        setPollingTasks(prev => ({ ...prev, [data.taskId as string]: true }));
        messageApi.success('等待中的任务已开始执行！');
      }
      
      // 请求完整任务列表以保持正确排序
      if (clientId) {
        requestClientTasks(clientId);
      }
    };
    
    // 处理任务恢复更新事件
    const handleTaskRecoveryUpdate = (data: TaskRecoveryUpdate) => {
      console.log('收到任务恢复通知:', data);
      
      // 验证clientId是否匹配，只处理当前客户端的任务
      if (data.clientId !== clientId) {
        return;
      }
      
      // 更新任务状态
      setTasks(prevTasks => {
        return prevTasks.map(task => {
          // 使用uniqueId匹配任务而不是createdAt
          if (task.uniqueId === data.uniqueId) {
            return {
              ...task,
              status: data.status,
              // 可能的其他更新
              ...(data.taskId ? { taskId: data.taskId } : {})
            };
          }
          return task;
        });
      });
      
      // 显示通知消息
      if (data.message) {
        messageApi.info(data.message);
      }
    };

    // 添加事件监听
    onWorkflowStatusUpdate(handleWorkflowStatusUpdate);
    onTaskRecoveryUpdate(handleTaskRecoveryUpdate);
    
    // 清理函数
    return () => {
      socket.off(socketEvents.workflowStatusUpdate, handleWorkflowStatusUpdate);
      socket.off(socketEvents.taskRecoveryUpdate, handleTaskRecoveryUpdate);
    };
  }, [apiKey, clientId, messageApi]);

  // 在useEffect中添加任务处理完成监听
  useEffect(() => {
    // 当任务处理完成时，处理等待队列
    const handleTaskProcessingCompleted = (data: { message: string, taskId: string }) => {
      console.log('收到任务处理完成通知:', data);
      onTaskCompleted();
    };
    
    // 注册监听器
    onTaskProcessingCompleted(handleTaskProcessingCompleted);
    
    return () => {
      socket.off(socketEvents.taskProcessingCompleted);
    };
  }, []);

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
    setPollingTasks(prev => ({ ...prev, [taskId as string]: isPolling }));
  };

  // 修改删除任务的处理函数
  const handleDeleteTask = async (taskIdOrUniqueId: string, isUniqueId: boolean = false, task?: WorkflowTask) => {
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
      const taskToDelete = task || prevTasks.find(t => {
        if (isUniqueId) {
          // 使用uniqueId删除任务（适用于WAITING状态）
          return t.uniqueId === taskIdOrUniqueId;
        } else {
          // 使用taskId删除任务
          return t.taskId === taskIdOrUniqueId;
        }
      });
      
      // 如果找到任务，根据状态执行不同的操作
      if (taskToDelete) {
        // 检查任务状态
        const status = taskToDelete.status;
        const taskId = taskToDelete.taskId;
        const uniqueId = taskToDelete.uniqueId;
        
        // WAITING状态的任务需要通知服务器从等待队列中删除
        if (status === 'WAITING' || status === TaskStatus.WAITING) {
          // 通知服务器从等待队列中删除任务
          notifyDeleteTask(
            uniqueId, // uniqueId
            taskToDelete.taskId || null, // taskId
            taskToDelete.createdAt, // createdAt
            true // isWaiting
          );
        } 
        // RETRY状态的任务使用uniqueId删除
        else if (status === 'RETRY' || status === TaskStatus.RETRY) {
          notifyDeleteTask(
            uniqueId, // uniqueId
            taskToDelete.taskId || null, // taskId
            taskToDelete.createdAt, // createdAt
            true // 将RETRY状态视为等待状态，因为它们都是pending队列中的任务
          );
        }
        // QUEUED或RUNNING状态的任务需要调用API取消任务执行
        else if ((status === 'QUEUED' || status === TaskStatus.QUEUED || 
                 status === 'RUNNING' || status === TaskStatus.RUNNING) && 
                 taskId) {
          // 调用取消任务API
          cancelTask(apiKey, taskId)
            .then(success => {
              if (success) {
                messageApi.success(`已成功取消任务 ${taskId}`);
                // 取消成功后也从数据库中删除
                notifyDeleteTask(
                  uniqueId, // uniqueId
                  taskId, // taskId
                  taskToDelete.createdAt, // createdAt
                  false // isWaiting
                );
              } else {
                messageApi.error(`取消任务 ${taskId} 失败`);
              }
            })
            .catch(error => {
              messageApi.error(`取消任务出错: ${error.message}`);
            });
        }
        // SUCCESS或FAILED状态的任务也需要从数据库中删除
        else if ((status === 'SUCCESS' || status === TaskStatus.SUCCESS || 
                 status === 'FAILED' || status === TaskStatus.FAILED) && 
                 taskId) {
          // 通知服务器从数据库中删除任务
          notifyDeleteTask(
            uniqueId, // uniqueId
            taskId, // taskId
            taskToDelete.createdAt, // createdAt
            false // isWaiting
          );
        }
      }
      
      // 过滤掉要删除的任务
      return prevTasks.filter(t => {
        if (isUniqueId) {
          return t.uniqueId !== taskIdOrUniqueId;
        } else {
          return t.taskId !== taskIdOrUniqueId;
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
                    onDeleteTask={(taskIdOrUniqueId, isUniqueId, task) => handleDeleteTask(taskIdOrUniqueId, isUniqueId, task)}
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
