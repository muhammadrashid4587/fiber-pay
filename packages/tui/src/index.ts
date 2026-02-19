import { render } from 'ink';
import React from 'react';
import { App } from './App.js';
import type { TuiConfig } from './config.js';

export type { TuiConfig, TuiConfigOverrides, CliConfigLike } from './config.js';
export { resolveTuiConfig } from './config.js';

export function renderDashboard(config: TuiConfig): void {
  render(React.createElement(App, { config }));
}
