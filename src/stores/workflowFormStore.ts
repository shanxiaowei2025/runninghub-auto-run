import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { get, set, del } from 'idb-keyval'
import { NodeInfo } from '../types'

// 自定义IndexedDB存储实现
const indexedDBStorage = {
  getItem: async (name: string): Promise<string | null> => {
    console.log(`[IndexedDB] 读取数据: ${name}`)
    try {
      const value = await get(name)
      return value ? JSON.stringify(value) : null
    } catch (error) {
      console.error(`[IndexedDB] 读取失败:`, error)
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    console.log(`[IndexedDB] 保存数据: ${name}`)
    try {
      const parsedValue = JSON.parse(value)
      await set(name, parsedValue)
    } catch (error) {
      console.error(`[IndexedDB] 保存失败:`, error)
    }
  },
  removeItem: async (name: string): Promise<void> => {
    console.log(`[IndexedDB] 删除数据: ${name}`)
    try {
      await del(name)
    } catch (error) {
      console.error(`[IndexedDB] 删除失败:`, error)
    }
  }
}

// 任务分组接口
export interface TaskGroup {
  nodeInfoList: NodeInfo[];
  executionCount: number;
}

// 表单数据接口
export interface WorkflowFormData {
  apiKey: string;
  workflowId: string;
  taskGroups: TaskGroup[];
}

// 表单Store接口
interface WorkflowFormStore {
  formData: WorkflowFormData;
  setApiKey: (apiKey: string) => void;
  setWorkflowId: (workflowId: string) => void;
  setTaskGroups: (taskGroups: TaskGroup[]) => void;
  addTaskGroup: () => void;
  removeTaskGroup: (groupIndex: number) => void;
  updateExecutionCount: (groupIndex: number, count: number) => void;
  addNodeInfo: (groupIndex: number) => void;
  removeNodeInfo: (groupIndex: number, nodeIndex: number) => void;
  updateNodeInfo: (groupIndex: number, nodeIndex: number, field: keyof NodeInfo, value: string) => void;
  resetForm: () => void;
}

// 初始表单数据
const initialFormData: WorkflowFormData = {
  apiKey: '',
  workflowId: '',
  taskGroups: [{ 
    nodeInfoList: [{ nodeId: '', fieldName: '', fieldValue: '' }],
    executionCount: 1
  }]
}

// 创建持久化的Store
export const useWorkflowFormStore = create<WorkflowFormStore>()(
  persist(
    (set) => ({
      formData: initialFormData,
      
      setApiKey: (apiKey: string) => set(state => ({
        formData: { ...state.formData, apiKey }
      })),
      
      setWorkflowId: (workflowId: string) => set(state => ({
        formData: { ...state.formData, workflowId }
      })),
      
      setTaskGroups: (taskGroups: TaskGroup[]) => set(state => ({
        formData: { ...state.formData, taskGroups }
      })),
      
      addTaskGroup: () => set(state => {
        const newTaskGroups = [
          ...state.formData.taskGroups, 
          { 
            nodeInfoList: [{ nodeId: '', fieldName: '', fieldValue: '' }],
            executionCount: 1
          }
        ];
        return { formData: { ...state.formData, taskGroups: newTaskGroups } };
      }),
      
      removeTaskGroup: (groupIndex: number) => set(state => {
        if (state.formData.taskGroups.length <= 1) return state;
        
        const newTaskGroups = [...state.formData.taskGroups];
        newTaskGroups.splice(groupIndex, 1);
        return { formData: { ...state.formData, taskGroups: newTaskGroups } };
      }),
      
      updateExecutionCount: (groupIndex: number, count: number) => set(state => {
        const newTaskGroups = [...state.formData.taskGroups];
        newTaskGroups[groupIndex] = { 
          ...newTaskGroups[groupIndex], 
          executionCount: count 
        };
        return { formData: { ...state.formData, taskGroups: newTaskGroups } };
      }),
      
      addNodeInfo: (groupIndex: number) => set(state => {
        const newTaskGroups = [...state.formData.taskGroups];
        newTaskGroups[groupIndex].nodeInfoList.push({ 
          nodeId: '', 
          fieldName: '', 
          fieldValue: '' 
        });
        return { formData: { ...state.formData, taskGroups: newTaskGroups } };
      }),
      
      removeNodeInfo: (groupIndex: number, nodeIndex: number) => set(state => {
        const newTaskGroups = [...state.formData.taskGroups];
        if (newTaskGroups[groupIndex].nodeInfoList.length > 1) {
          newTaskGroups[groupIndex].nodeInfoList.splice(nodeIndex, 1);
        }
        return { formData: { ...state.formData, taskGroups: newTaskGroups } };
      }),
      
      updateNodeInfo: (groupIndex: number, nodeIndex: number, field: keyof NodeInfo, value: string) => set(state => {
        const newTaskGroups = [...state.formData.taskGroups];
        newTaskGroups[groupIndex].nodeInfoList[nodeIndex] = { 
          ...newTaskGroups[groupIndex].nodeInfoList[nodeIndex], 
          [field]: value 
        };
        return { formData: { ...state.formData, taskGroups: newTaskGroups } };
      }),
      
      resetForm: () => set({ formData: initialFormData }),
    }),
    {
      name: 'workflow-form-storage', // 存储在IndexedDB中的键名
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => ({ formData: state.formData }), // 只存储formData部分
    }
  )
) 