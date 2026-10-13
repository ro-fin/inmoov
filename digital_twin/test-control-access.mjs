import assert from 'node:assert/strict';
import {controlAccess,handSignAccess} from './control-access.js';
const base={authorized:true,online:true,preview:false,ready:true,wired:true,enabled:false,playing:false};
assert.equal(controlAccess(base).canEnable,true);
assert.equal(controlAccess(base).canMove,false);
assert.equal(controlAccess({...base,enabled:true}).canMove,true);
for(const flags of [{authorized:false},{online:false},{preview:true},{ready:false},{wired:false},{playing:true}]){
  const access=controlAccess({...base,...flags});
  assert.equal(access.canEnable,false);
  assert.equal(access.canMove,false);
}
assert.match(controlAccess({...base,authorized:false}).message,/LAUNCH_ARM_DESKTOP/);
console.log('PASS: full-view enable/movement gates, preview isolation, missing-session message and motion lock.');
const signs={authorized:true,online:true,preview:false,ready:true,busy:true,playing:false,recording:false,inFlight:false,rightEnabled:false,knownHome:true};
assert.equal(handSignAccess(signs).canStart,true);
for(const flags of [{authorized:false},{online:false},{preview:true},{ready:false},{playing:true},{recording:true},{inFlight:true},{rightEnabled:true},{knownHome:false}]){
  const result=handSignAccess({...signs,...flags});
  assert.equal(result.canStart,false);
  assert.ok(result.message.length>15);
}
assert.equal(handSignAccess({...signs,knownHome:false}).action,'home');
assert.equal(handSignAccess({...signs,ready:false,busy:false}).action,'connect');
assert.equal(handSignAccess({...signs,preview:true}).action,'robot');
assert.match(handSignAccess({...signs,rightEnabled:true}).message,/D6–D9/);
console.log('PASS: hand signs become available only with connection, confirmed starting pose and idle channels; blocked states explain the next step.');
