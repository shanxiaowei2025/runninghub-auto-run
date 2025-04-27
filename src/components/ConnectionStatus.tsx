import { useState, useEffect } from 'react';
import { socket, onConnect, onDisconnect } from '../services/socket';
import { Badge, Space, Typography } from 'antd';

const { Text } = Typography;

export default function ConnectionStatus() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [lastPing, setLastPing] = useState<Date | null>(null);

  useEffect(() => {
    // 连接成功回调
    const handleConnect = () => {
      setIsConnected(true);
      setLastPing(new Date());
    };

    // 断开连接回调
    const handleDisconnect = () => {
      setIsConnected(false);
    };

    // 注册事件监听
    onConnect(handleConnect);
    onDisconnect(handleDisconnect);

    // 组件卸载时清除监听
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);

  return (
    <Space align="center">
      <Badge 
        status={isConnected ? 'success' : 'error'} 
        text={
          <Text strong>
            {isConnected ? '服务器已连接' : '服务器断开连接'}
          </Text>
        } 
      />
      {lastPing && (
        <Text type="secondary" style={{ fontSize: '12px' }}>
          上次连接时间: {lastPing.toLocaleTimeString()}
        </Text>
      )}
    </Space>
  );
} 