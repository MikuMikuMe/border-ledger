/* Read-only debug-host contract smoke via Hermes CDP. No auth or financial writes. */
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  let page;
  for (let attempt = 0; attempt < 50 && !page; attempt++) {
    const pages = await (await fetch('http://127.0.0.1:8081/json/list')).json();
    page = pages.find(item => (item.appId || item.app) === 'com.lofuyu.borderledger.probe');
    if (!page) await sleep(100);
  }
  assert(page, 'The debug emulator host must be connected to Metro');
  // RN 0.87 inspector requires an explicit allowed local Origin for CLI clients.
  const socket = new WebSocket(page.webSocketDebuggerUrl, {origin: 'http://127.0.0.1:8081'});
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const pending = new Map();
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error('CDP request failed (' + message.error.code + ')')) : entry.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params}));
  });
  try {
    await call('Runtime.enable');
    const expression = `
      globalThis.__borderLedgerBridgeSmoke = null;
      globalThis.__borderLedgerBridgeSmokeStage = 'registration';
      (async () => {
        const contracts = {
          NativeSession: ['getSnapshot','refreshOnResume','beginLogin','signOut','consumePendingDestination','queryOperation','readOperations','cancelOperation','onStateChanged'],
          NativeLedger: ['getSnapshot','refreshSnapshot','readTransactions','readReport','startCaptureSync','onChanged'],
          NativeRecurring: ['readPage','readSummary','readDetail','startClassify','onChanged'],
          NativeReview: ['readAlerts','startReview','startAnnotate','onChanged'],
          NativeAccounts: ['getSnapshot','readAccounts','readConnections','startConnect','startSelectAccounts','startCancelPending','startSync','startDisconnect','onStateChanged'],
          NativeCaptureDevices: ['getSnapshot','getRuntimeHealth','refresh','readDevices','selectSource','requestSourceTest','openNotificationSettings','openAppNotificationSettings','startAuthorizeCapture','startRevokeDevice','startReplaceSourceConfig','startAuthorizeDevice','onStateChanged','onHealthChanged'],
          NativeFiles: ['getSnapshot','readImportRows','startPickImport','setRowSelected','startDecideDuplicate','startCommitImport','startCancelImport','startExport','onStateChanged'],
          NativePreferences: ['getSnapshot','updateDisplay','readReporting','startUpdateReporting','onChanged']
        };
        const modules = {};
        for (const [name, methods] of Object.entries(contracts)) {
          globalThis.__borderLedgerBridgeSmokeStage = name;
          const module = typeof globalThis.__turboModuleProxy === 'function'
            ? globalThis.__turboModuleProxy(name) : globalThis.nativeModuleProxy?.[name];
          if (!module || methods.some(method => typeof module[method] !== 'function')) throw new Error('Contract unavailable');
          modules[name] = module;
        }
        let events = 0;
        globalThis.__borderLedgerBridgeSmokeStage = 'session_subscription';
        const subscription = modules.NativeSession.onStateChanged(() => { events++; });
        const first = await modules.NativeSession.getSnapshot();
        globalThis.__borderLedgerBridgeSmokeStage = 'preferences_snapshot';
        const display = await modules.NativePreferences.getSnapshot();
        const resumed = await modules.NativeSession.refreshOnResume();
        globalThis.__borderLedgerBridgeSmokeStage = 'snapshot_validation';
        await new Promise(resolve => setTimeout(resolve, 150));
        subscription.remove();
        const expected = ['state','expiresAt','pendingDestination','reason','pendingRevocations','environment'];
        if (Object.keys(first).sort().join() !== expected.sort().join()) throw new Error('Unexpected session fields');
        if (resumed.environment !== 'sandbox') throw new Error('Smoke must use sandbox');
        let ownerReadRejected = null;
        if (resumed.state !== 'signed_in') {
          try { await modules.NativeLedger.getSnapshot(); ownerReadRejected = false; }
          catch (_) { ownerReadRejected = true; }
        }
        return {modules: Object.keys(modules).length, state: resumed.state, environment: resumed.environment,
          sessionEvents: events, ownerReadRejected, appearance: display.appearanceMode};
      })().then(value => { globalThis.__borderLedgerBridgeSmoke = value; })
        .catch(() => { globalThis.__borderLedgerBridgeSmoke = {failed: true, stage: globalThis.__borderLedgerBridgeSmokeStage}; });
      'started';
    `;
    const started = await call('Runtime.evaluate', {expression, returnByValue: true});
    if (started.exceptionDetails) console.log(JSON.stringify({evaluationError: started.exceptionDetails.text, description: started.exceptionDetails.exception?.description?.split('\n')[0]}));
    assert(!started.exceptionDetails, 'Native bridge smoke could not start');
    let result;
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await call('Runtime.evaluate', {expression: 'JSON.stringify(globalThis.__borderLedgerBridgeSmoke)', returnByValue: true});
      const value = response.result?.value;
      if (value && value !== 'null') { result = JSON.parse(value); break; }
      await sleep(100);
    }
    await call('Runtime.evaluate', {expression: 'delete globalThis.__borderLedgerBridgeSmoke; delete globalThis.__borderLedgerBridgeSmokeStage'});
    if (result?.failed) console.log(JSON.stringify(result));
    assert(result && !result.failed, 'A native module or snapshot contract failed');
    assert.equal(result.modules, 8);
    assert(result.sessionEvents > 0, 'Resume must publish a session event');
    assert.notEqual(result.ownerReadRejected, false);
    console.log(JSON.stringify(result));
  } finally { socket.close(); }
}

main().catch(error => { console.error('Native bridge smoke failed: ' + (error.message || 'inspector connection error')); process.exitCode = 1; });
