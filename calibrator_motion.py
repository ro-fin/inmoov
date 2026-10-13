"""Bounded gesture planner; no serial connection or hardware side effects."""
import json
import math
from pathlib import Path
from standalone_motion.hi_loop import PINS, SPEED, move_duration, gesture_plan

SAFETY_DATA = json.loads((Path(__file__).parent/'standalone_motion'/'left_arm_safety.json').read_text())
JOINT_SAFETY = {j['pin']: j for j in SAFETY_DATA['joints']}
OFFSETS = {2:(0,29),3:(-25,40),4:(-31,72),5:(0,68)}
GESTURE_NAMES = {'hi':'Hi', 'stop':'Stop sign', 'left':'Go left', 'sequence':'Hi → Stop → Go left'}
STEP_UNITS = 10
FRAME_INTERVAL = .25
# Use the smaller pulse/unit ratio on either side of home so no step exceeds
# ten displayed units, including a step that crosses home.
MAX_STEP_US = {}
for pin, joint in JOINT_SAFETY.items():
    low, high = OFFSETS[pin]
    ratios = [(joint['home_us']-joint['min_us'])/high]
    if low:
        ratios.append((joint['max_us']-joint['home_us'])/abs(low))
    MAX_STEP_US[pin] = math.floor(STEP_UNITS*min(ratios))

def safety_rules():
    return [dict(pin=p, minUs=j['min_us'], maxUs=j['max_us'], homeUs=j['home_us'],
                 rawHome=j['raw_home'], rawMin=min(v for k,v in j.items() if k.startswith('raw_')),
                 rawMax=max(v for k,v in j.items() if k.startswith('raw_')),
                 offsetMin=OFFSETS[p][0], offsetMax=OFFSETS[p][1])
            for p,j in JOINT_SAFETY.items()]

def apply_safety(profiles):
    result=[dict(p) for p in profiles]
    for p in result:
        if p['pin'] in JOINT_SAFETY:
            j=JOINT_SAFETY[p['pin']]
            p.update(minUs=j['min_us'],maxUs=j['max_us'],restUs=j['home_us'],reversed=False)
    return result

class GestureRun:
    """One shared trajectory clock. Advance only after every frame is acknowledged."""
    def __init__(self, name, profiles, start, loop=False, now=0, home_only=False):
        if name not in GESTURE_NAMES:
            raise ValueError('Unknown hand sign.')
        self.profiles={p['pin']:p for p in profiles}
        home=tuple(JOINT_SAFETY[p]['home_us'] for p in PINS)
        for pin,value in zip(PINS,start):
            p=self.profiles[pin]
            if p['restUs']!=JOINT_SAFETY[pin]['home_us'] or p.get('reversed',False):
                raise ValueError('Restore the tested left-arm homes and directions before gestures.')
            if not p['minUs']<=value<=p['maxUs']:
                raise ValueError('Starting command exceeds calibrated limits.')
        self.name, self.loop = name, loop and not home_only
        self.home_only=home_only
        self.plan = ([('home',tuple(start),home,move_duration(start,home))] if home_only else gesture_plan(SAFETY_DATA,name))
        if not home_only and tuple(start)!=home:
            self.plan.insert(0,('initial_home',tuple(start),home,move_duration(start,home)))
        self.plan.append(('rest',home,home,2*SPEED))
        # Preserve gesture poses and hold times; replace the slow eased ramps
        # with a shared sequence of bounded, larger position commands.
        self.plan = [(phase,a,b,
                      max(math.ceil(abs(y-x)/MAX_STEP_US[p]) for p,x,y in zip(PINS,a,b))*FRAME_INTERVAL
                      if a!=b else duration/SPEED)
                     for phase,a,b,duration in self.plan]
        for _,a,b,_ in self.plan:
            for pose in (a,b):
                if any(not self.profiles[p]['minUs']<=v<=self.profiles[p]['maxUs'] for p,v in zip(PINS,pose)):
                    raise ValueError('This gesture exceeds your current calibrated limits.')
        self.phase=0
        self.elapsed=0
        self.last_tick=self.last_frame=now
        self.last_target=tuple(start)
        self.pending={}
        self.sent_at=now
        self.started=False
        self.finished=False
        self.cycles=0

    def acknowledge(self,pin,pulse):
        if self.pending.get(pin)==pulse:
            del self.pending[pin]

    def next_frame(self,now):
        if self.finished: return None
        if now-self.last_tick>.75:
            raise RuntimeError('Gesture stopped: controller timing gap.')
        self.last_tick=now
        if self.pending:
            if now-self.sent_at>1.6:
                raise RuntimeError('Gesture stopped: command acknowledgement missing.')
            return None
        if now-self.last_frame<FRAME_INTERVAL and self.started: return None
        if self.started and self.elapsed>=self.plan[self.phase][3]:
            self.phase+=1
            self.elapsed=0
            if self.phase==len(self.plan):
                self.cycles+=1
                if not self.loop:
                    self.finished=True
                    return None
                self.phase=0
        _,start,end,duration=self.plan[self.phase]
        if self.started:
            self.elapsed=min(duration,self.elapsed+FRAME_INTERVAL)
        fraction=min(1,self.elapsed/duration) if duration else 1
        target=tuple(round(x+(y-x)*fraction) for x,y in zip(start,end))
        if any(abs(x-y)>MAX_STEP_US[p] for p,x,y in zip(PINS,self.last_target,target)):
            raise RuntimeError('Gesture stopped: discontinuous target.')
        self.last_target=target
        self.started=True
        self.last_frame=self.sent_at=now
        self.pending=dict(zip(PINS,target))
        return target

    def state(self):
        return dict(active=not self.finished,name=self.name,label=GESTURE_NAMES[self.name],loop=self.loop,
                    phase=self.plan[min(self.phase,len(self.plan)-1)][0],cycles=self.cycles,
                    homeOnly=self.home_only,waitingForAck=bool(self.pending),stepUnits=STEP_UNITS,frameInterval=FRAME_INTERVAL)
