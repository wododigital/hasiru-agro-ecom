'use client';

import { Component, type ReactNode } from 'react';

/** Keeps one broken dashboard widget from taking the whole dashboard down. */
export class WidgetBoundaryIsland extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="status" className="text-sm text-muted">
        {`${this.props.title} could not load. The error is logged under Health.`}
      </p>
    );
  }
}
