import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '');
  
  // 基于环境变量判断是否为远程访问
  const isRemote = env.VITE_REMOTE_MODE === 'true';
  
  // HMR配置，根据环境动态调整
  let hmrConfig = {};
  
  // 根据环境变量配置HMR
  if (isRemote) {
    // 远程访问配置
    hmrConfig = {
      protocol: env.VITE_HMR_PROTOCOL || 'wss',
      host: env.VITE_HMR_HOST || 'runninghub-auto-run.starlogic.tech',
      port: parseInt(env.VITE_HMR_PORT || '443'),
      clientPort: parseInt(env.VITE_HMR_CLIENT_PORT || '443'),
      path: env.VITE_HMR_PATH || '/__hmr'
    };
  } else {
    // 本地开发配置
    hmrConfig = {
      protocol: env.VITE_HMR_PROTOCOL || 'ws',
      host: env.VITE_HMR_HOST || 'localhost',
      port: parseInt(env.VITE_HMR_PORT || '24678')
    };
  }
  
  console.log(`当前环境: ${mode}, 远程模式: ${isRemote}`);
  console.log('HMR配置:', hmrConfig);
  
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      host: true,
      allowedHosts: ['runninghub-auto-run.starlogic.tech'],
      proxy: {
        '/api': {
          target: 'http://localhost:5173',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:5173',
          ws: true,
        }
      },
      hmr: hmrConfig
    }
  };
})
