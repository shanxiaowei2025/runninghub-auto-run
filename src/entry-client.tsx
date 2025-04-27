import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import '@ant-design/v5-patch-for-react-19';
import App from './App';
import './index.css';

const container = document.getElementById('app');

if (container) {
  hydrateRoot(
    container,
    <App />
  );
} 