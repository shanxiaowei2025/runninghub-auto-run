// 添加取消任务的服务函数
export const cancelTask = async (apiKey: string, taskId: string): Promise<boolean> => {
  try {
    const response = await fetch('https://www.runninghub.cn/task/openapi/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'www.runninghub.cn',
      },
      body: JSON.stringify({ apiKey, taskId }),
    });
    
    const result = await response.json();
    
    if (result.code === 0) {
      console.log(`成功取消任务 ${taskId}`);
      return true;
    } else {
      console.error(`取消任务失败: ${result.msg}`);
      return false;
    }
  } catch (error) {
    console.error('取消任务出错:', error);
    return false;
  }
}; 