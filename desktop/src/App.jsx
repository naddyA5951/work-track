/**
 * QuietPulse Windows Desktop React Renderer (`desktop/src/App.jsx`)
 * Shares 100% of business logic (`@quietpulse/shared`) with the React Native mobile app
 * and integrates with `window.electronDnd` for Windows Focus Assist / Toast suppression
 * and Full-Screen Focus Lockout fallback.
 */

import React from 'react';
import WebWorkspaceApp from '../../src/App';

export default function DesktopApp() {
  return <WebWorkspaceApp />;
}
