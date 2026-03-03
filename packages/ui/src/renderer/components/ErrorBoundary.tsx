import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: "2rem", color: "var(--solix-red)" }}>
            <strong>Something went wrong:</strong>
            <pre style={{ marginTop: 8, fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
              {this.state.message}
            </pre>
            <button
              style={{ marginTop: 12, padding: "4px 12px" }}
              onClick={() => this.setState({ hasError: false, message: "" })}
            >
              Retry
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
