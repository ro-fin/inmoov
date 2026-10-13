// UI gates only. The server still authenticates and validates every hardware action.
export function handSignAccess({authorized,online,preview,ready,busy,playing,recording,inFlight,rightEnabled,knownHome}) {
  const blocked=(message,action='')=>({canStart:false,message,action});
  if(!authorized)return blocked('Enter a pairing code in Restore control session to activate this tab.');
  if(!online)return blocked('Waiting for the controller service to reconnect.');
  if(preview)return blocked('Choose Robot mode to run the real arm.','robot');
  if(!ready)return blocked(busy?'Waiting for the Nano connection.':'Connect the Nano to run hand signs.',busy?'':'connect');
  if(playing||recording)return blocked('Stop the current motion or finish recording before starting another hand sign.');
  if(rightEnabled)return blocked('Release the right-arm joints D6–D9 before running left-arm hand signs.');
  if(inFlight)return blocked('Waiting for the last command acknowledgement.');
  if(!knownHome)return blocked('Check that the left arm is physically home, then tick the confirmation below.','home');
  return {canStart:true,message:'Ready. Choose Hi, Stop sign, Go left, or the combined sequence.',action:''};
}
export function controlAccess({authorized,online,preview,ready,wired,enabled,playing}) {
  if(!authorized)return {canEnable:false,canMove:false,message:'Enter a pairing code in Restore control session, or open LAUNCH_ARM_DESKTOP.bat.'};
  if(!online)return {canEnable:false,canMove:false,message:'Controller connection unavailable. Wait for it to reconnect.'};
  if(preview)return {canEnable:false,canMove:false,message:'Preview only. Choose Robot mode to control a servo.'};
  if(!ready)return {canEnable:false,canMove:false,message:'Connect the Nano, then enable the selected joint at home.'};
  if(!wired)return {canEnable:false,canMove:false,message:'This joint is a reference only. Choose D2–D9 for robot control.'};
  if(playing)return {canEnable:false,canMove:false,message:'A gesture or recording is running. Stop it before manual control.'};
  return {canEnable:!enabled,canMove:!!enabled,message:enabled?'Live commands enabled for this joint.':'Nano connected. Click Enable at home to activate this joint.'};
}
