const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('jarvisDesktop', {
  getConnection: profile => ipcRenderer.invoke('jarvis:connection', profile),
  revalidateConnection: () => ipcRenderer.invoke('jarvis:connection:revalidate'),
  touchBackend: profile => ipcRenderer.invoke('jarvis:backend:touch', profile),
  getGatewayWsUrl: profile => ipcRenderer.invoke('jarvis:gateway:ws-url', profile),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('jarvis:window:openSession', sessionId, opts),
  openNewSessionWindow: () => ipcRenderer.invoke('jarvis:window:openNewSession'),
  getBootProgress: () => ipcRenderer.invoke('jarvis:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('jarvis:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('jarvis:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('jarvis:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('jarvis:connection-config:test', payload),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('jarvis:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('jarvis:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('jarvis:connection-config:oauth-logout', remoteUrl),
  profile: {
    get: () => ipcRenderer.invoke('jarvis:profile:get'),
    set: name => ipcRenderer.invoke('jarvis:profile:set', name)
  },
  api: request => ipcRenderer.invoke('jarvis:api', request),
  notify: payload => ipcRenderer.invoke('jarvis:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('jarvis:requestMicrophoneAccess'),
  readFileDataUrl: filePath => ipcRenderer.invoke('jarvis:readFileDataUrl', filePath),
  readFileText: filePath => ipcRenderer.invoke('jarvis:readFileText', filePath),
  selectPaths: options => ipcRenderer.invoke('jarvis:selectPaths', options),
  writeClipboard: text => ipcRenderer.invoke('jarvis:writeClipboard', text),
  saveImageFromUrl: url => ipcRenderer.invoke('jarvis:saveImageFromUrl', url),
  saveImageBuffer: (data, ext) => ipcRenderer.invoke('jarvis:saveImageBuffer', { data, ext }),
  saveClipboardImage: () => ipcRenderer.invoke('jarvis:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('jarvis:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('jarvis:watchPreviewFile', url),
  stopPreviewFileWatch: id => ipcRenderer.invoke('jarvis:stopPreviewFileWatch', id),
  setTitleBarTheme: payload => ipcRenderer.send('jarvis:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('jarvis:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('jarvis:translucency', payload),
  setPreviewShortcutActive: active => ipcRenderer.send('jarvis:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('jarvis:openExternal', url),
  fetchLinkTitle: url => ipcRenderer.invoke('jarvis:fetchLinkTitle', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('jarvis:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('jarvis:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('jarvis:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('jarvis:setting:defaultProjectDir:pick')
  },
  revealLogs: () => ipcRenderer.invoke('jarvis:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('jarvis:logs:recent'),
  readDir: dirPath => ipcRenderer.invoke('jarvis:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('jarvis:fs:gitRoot', startPath),
  worktrees: cwds => ipcRenderer.invoke('jarvis:fs:worktrees', cwds),
  terminal: {
    dispose: id => ipcRenderer.invoke('jarvis:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('jarvis:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('jarvis:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('jarvis:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `jarvis:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `jarvis:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('jarvis:close-preview-requested', listener)
    return () => ipcRenderer.removeListener('jarvis:close-preview-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('jarvis:open-updates', listener)
    return () => ipcRenderer.removeListener('jarvis:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('jarvis:deep-link', listener)
    return () => ipcRenderer.removeListener('jarvis:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('jarvis:deep-link-ready'),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('jarvis:window-state-changed', listener)
    return () => ipcRenderer.removeListener('jarvis:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('jarvis:focus-session', listener)
    return () => ipcRenderer.removeListener('jarvis:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('jarvis:notification-action', listener)
    return () => ipcRenderer.removeListener('jarvis:notification-action', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('jarvis:preview-file-changed', listener)
    return () => ipcRenderer.removeListener('jarvis:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('jarvis:backend-exit', listener)
    return () => ipcRenderer.removeListener('jarvis:backend-exit', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('jarvis:power-resume', listener)
    return () => ipcRenderer.removeListener('jarvis:power-resume', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('jarvis:boot-progress', listener)
    return () => ipcRenderer.removeListener('jarvis:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.cjs (apps/desktop/electron/bootstrap-runner.cjs).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('jarvis:bootstrap:get'),
  resetBootstrap: () => ipcRenderer.invoke('jarvis:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('jarvis:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('jarvis:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('jarvis:bootstrap:event', listener)
    return () => ipcRenderer.removeListener('jarvis:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('jarvis:version'),
  uninstall: {
    summary: () => ipcRenderer.invoke('jarvis:uninstall:summary'),
    run: mode => ipcRenderer.invoke('jarvis:uninstall:run', { mode })
  },
  updates: {
    check: () => ipcRenderer.invoke('jarvis:updates:check'),
    apply: opts => ipcRenderer.invoke('jarvis:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('jarvis:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('jarvis:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('jarvis:updates:progress', listener)
      return () => ipcRenderer.removeListener('jarvis:updates:progress', listener)
    }
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('jarvis:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('jarvis:vscode-theme:search', query)
  },
  notch: {
    // Conversation state pushed out to the native notch (fire-and-forget,
    // high-frequency audio levels included — hence send, not invoke).
    publish: payload => ipcRenderer.send('jarvis:notch:publish', payload),
    focusMain: () => ipcRenderer.invoke('jarvis:notch:focus-main'),
    getSettings: () => ipcRenderer.invoke('jarvis:notch:settings:get'),
    requestPermission: id => ipcRenderer.invoke('jarvis:notch:permission:request', id),
    setSetting: (key, value) => ipcRenderer.invoke('jarvis:notch:settings:set', { key, value }),
    restart: () => ipcRenderer.invoke('jarvis:notch:restart'),
    onCommand: callback => {
      const listener = (_event, message) => callback(message)
      ipcRenderer.on('jarvis:notch:command', listener)
      return () => ipcRenderer.removeListener('jarvis:notch:command', listener)
    },
    onSettings: callback => {
      const listener = (_event, snapshot) => callback(snapshot)
      ipcRenderer.on('jarvis:notch:settings', listener)
      return () => ipcRenderer.removeListener('jarvis:notch:settings', listener)
    }
  },
  mobile: {
    enable: enabled => ipcRenderer.invoke('jarvis:mobile:enable', enabled),
    getState: () => ipcRenderer.invoke('jarvis:mobile:state'),
    pair: () => ipcRenderer.invoke('jarvis:mobile:pair'),
    revoke: id => ipcRenderer.invoke('jarvis:mobile:revoke', id),
    setRelayUrl: url => ipcRenderer.invoke('jarvis:mobile:relay:set', url),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('jarvis:mobile:state', listener)
      return () => ipcRenderer.removeListener('jarvis:mobile:state', listener)
    },
    onActivity: callback => {
      const listener = () => callback()
      ipcRenderer.on('jarvis:mobile:activity', listener)
      return () => ipcRenderer.removeListener('jarvis:mobile:activity', listener)
    }
  },
  launchAtLogin: {
    get: () => ipcRenderer.invoke('jarvis:launchAtLogin:get'),
    set: enabled => ipcRenderer.invoke('jarvis:launchAtLogin:set', enabled)
  }
})
