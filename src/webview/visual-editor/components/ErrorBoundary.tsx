import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Visual Editor Error Boundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    
    // Also notify the VS Code extension to refresh the editor
    if (window.vscode) {
      window.vscode.postMessage({ command: 'ready' });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-icon">⚠️</div>
            <h2>Visual Editor Error</h2>
            <p>The visual editor encountered an error but the application is still running.</p>
            <p>You can try again or continue using other features.</p>
            
            <div className="error-actions">
              <button 
                onClick={this.handleRetry}
                className="retry-button primary"
              >
                Try Again
              </button>
              <button 
                onClick={() => {
                  if (window.vscode) {
                    window.vscode.postMessage({ command: 'requestOfferingsData' });
                  }
                  this.handleRetry();
                }}
                className="retry-button secondary"
              >
                Reload Data
              </button>
            </div>
            
            <details style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
              <summary>Technical Details</summary>
              <div className="error-details">
                <strong>Error:</strong> {this.state.error?.message || 'Unknown error'}
                <br />
                <strong>Stack:</strong> {this.state.error?.stack}
                <br />
                <strong>Component Stack:</strong> {this.state.errorInfo?.componentStack}
              </div>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}