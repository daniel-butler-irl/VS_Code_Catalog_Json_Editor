// React import not needed with modern JSX transform
import { createRoot } from 'react-dom/client';
import { VisualEditorApp } from './components/App';

console.log('Visual Editor: Script loading started');

// VS Code API for webview communication
declare const vscode: {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};

// Make vscode API available globally
(window as any).vscode = vscode;

console.log('Visual Editor: VS Code API available:', !!vscode);
console.log('Visual Editor: Window vscode set:', !!(window as any).vscode);

// Initialize React app
const container = document.getElementById('visual-editor-root');
console.log('Visual Editor: Root container found:', !!container);

if (container) {
  console.log('Visual Editor: Creating React root');
  try {
    const root = createRoot(container);
    console.log('Visual Editor: React root created, rendering app');
    root.render(<VisualEditorApp />);
    console.log('Visual Editor: App rendered successfully');
  } catch (error) {
    console.error('Visual Editor: Error creating React root or rendering app:', error);
  }
} else {
  console.error('Visual Editor: Root container not found - DOM elements:', document.body.innerHTML);
}