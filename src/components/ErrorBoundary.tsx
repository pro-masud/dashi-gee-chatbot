'use client';

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#FAF7F2] px-6 text-[#1E1710]">
          <div className="max-w-md rounded-2xl border border-[rgba(30,23,16,0.14)] bg-[#F2ECE1] p-8 text-center">
            <h1 className="font-display text-2xl font-semibold">
              Something went wrong
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#635647]">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-lg bg-[#B47B2B] px-5 py-2.5 text-sm font-medium text-[#FFFDF9] hover:bg-[#96621B]"
            >
              Reload Storefront
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
