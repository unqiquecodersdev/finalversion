import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-slate-950 text-slate-200 flex flex-col items-center justify-center p-6 z-[9999] overflow-auto select-text">
          <div className="bg-slate-900 border border-red-500/25 p-8 rounded-3xl max-w-2xl w-full shadow-2xl space-y-6">
            <div className="flex items-center gap-3 text-red-400 font-bold border-b border-white/10 pb-4">
              <span className="text-2xl">⚠️</span>
              <h2 className="text-lg">Classroom Session Crash Detected</h2>
            </div>
            
            <div className="space-y-2">
              <p className="text-xs text-slate-400 font-sans">An unexpected error occurred during rendering. Please copy the error message below and report it:</p>
              <div className="bg-slate-950 p-4 rounded-xl border border-white/5 font-mono text-[11px] text-red-300 overflow-x-auto whitespace-pre-wrap">
                {this.state.error && this.state.error.toString()}
              </div>
            </div>

            {this.state.errorInfo && (
              <div className="space-y-2">
                <p className="text-xs text-slate-400 font-sans">Component Stack Trace:</p>
                <div className="bg-slate-950 p-4 rounded-xl border border-white/5 font-mono text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap max-h-48">
                  {this.state.errorInfo.componentStack}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-indigo-650 hover:bg-indigo-600 text-white font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer"
              >
                Reload Window
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
