// Run independently of 3D rendering and main-thread fetches.
let token='', running=false;
self.linkHeartbeatStats={count:0,last:0};
onmessage = e => { token=e.data.token; };
setInterval(async () => {
  if (!token || running) return;
  running=true;
  try {
    const response=await fetch('/api/heartbeat', {headers:{'X-Studio-Token':token},cache:'no-store',signal:AbortSignal.timeout(2000)});
    if (response.ok) { self.linkHeartbeatStats.count++; self.linkHeartbeatStats.last=Date.now(); }
  }
  catch { /* Main-page status polling reports HTTP loss. */ }
  finally { running=false; }
},500);
