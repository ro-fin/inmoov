"""Standalone four-joint gestures. No calibrator configuration writes."""
import argparse
import json
import math
import queue
import threading
import time
from standalone_motion.home_joint import SAFETY, validate_joint, lift_value_to_pulse

PINS = (2, 3, 4, 5)
SPEED = 1.1
BASE_SLEW = 40

def ease(t, duration):
    t = max(0, min(duration, t))
    u = t / duration
    return 10*u**3 - 15*u**4 + 6*u**5

def blend(a, b, t, duration):
    f = ease(t, duration)
    return tuple(round(x + (y - x) * f) for x, y in zip(a, b))

def poses(data, gesture_name='hi'):
    joints = {j['pin']: validate_joint(j) for j in data['joints']}
    home = tuple(joints[p]['home_us'] for p in PINS)
    def convert(raw):
        result = []
        for pin in PINS:
            joint = joints[pin]
            value = raw[str(pin)]
            if not math.isfinite(value):
                raise ValueError('Nonfinite gesture target')
            if value == joint['raw_home']:
                pulse = joint['home_us']
            elif pin == 5:
                fraction = (joint['raw_home']-value)/(joint['raw_home']-joint['raw_max_lift'])
                pulse = lift_value_to_pulse(joint, fraction*joint['display_max_lift'])
            else:
                pulse = round(500 + value*2000/270)
            if not joint['min_us'] <= pulse <= joint['max_us']:
                raise ValueError('Gesture target outside standalone limits')
            result.append(pulse)
        return tuple(result)
    gesture = data[gesture_name+'_gesture']
    if 'raw_pose' in gesture:
        target = convert(gesture['raw_pose'])
        return joints, home, target, target
    return joints, home, convert(gesture['raw_pose_a']), convert(gesture['raw_pose_b'])

def move_duration(start, target):
    # Quintic easing's peak derivative is 1.875; actual peak <= 44 us/s.
    return max(2, 1.875*max(abs(x-y) for x,y in zip(start,target))/BASE_SLEW)

def gesture_plan(data, gesture_name='hi'):
    if gesture_name == 'sequence':
        plan = []
        for name in ('hi','stop','left'):
            single = gesture_plan(data,name)
            plan.extend((name+'_'+phase,start,end,duration) for phase,start,end,duration in single)
            if name != 'left':
                home = single[-1][2]
                plan.append((name+'_rest',home,home,data[name+'_gesture']['rest_seconds']*SPEED))
        return plan
    joints, home, a, b = poses(data,gesture_name)
    config = data[gesture_name+'_gesture']
    if gesture_name == 'hi' and (type(config['waves']) is not int or not 1 <= config['waves'] <= 3):
        raise ValueError('Hi needs one to three waves')
    for key in ('hold_seconds', 'rest_seconds'):
        if not math.isfinite(config[key]) or not 0 <= config[key] <= 5:
            raise ValueError('Invalid gesture hold time')
    phase = 'extend_left' if gesture_name == 'left' else 'raise'
    plan = [(phase, home, a, move_duration(home,a))]
    for wave in range(1,config.get('waves',0)+1):
        plan.extend([(f'wave_{wave}_out',a,b,move_duration(a,b)),
                     (f'wave_{wave}_back',b,a,move_duration(b,a))])
    plan.append(('hold',a,a,config['hold_seconds']*SPEED))
    plan.append(('home',a,home,move_duration(a,home)))
    return plan

def starting_pulses(states, joints, confirmed_home):
    if any(states[p] == 0 for p in PINS) and not confirmed_home:
        raise ValueError('Detached outputs do not reveal position; confirm physical home first')
    values = tuple(states[p] if states[p] else joints[p]['home_us'] for p in PINS)
    if any(not joints[p]['min_us'] <= v <= joints[p]['max_us'] for p,v in zip(PINS,values)):
        raise ValueError('Initial pulse outside standalone limits')
    return values

class HomeRequest(Exception):
    pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port')
    parser.add_argument('--gesture',choices=('hi','stop','left','sequence'),default='hi')
    parser.add_argument('--cycles',type=int,default=1,help='One trial by default; zero loops until stop')
    parser.add_argument('--confirmed-home',action='store_true')
    parser.add_argument('--dry-run',action='store_true')
    args = parser.parse_args()
    data = json.loads(SAFETY.read_text(encoding='utf-8'))
    first_gesture = 'hi' if args.gesture == 'sequence' else args.gesture
    joints, home, a, b = poses(data,first_gesture)
    plan = gesture_plan(data,args.gesture)
    if args.cycles < 0:
        parser.error('cycles cannot be negative')
    if args.dry_run:
        print(json.dumps({'gesture':args.gesture,'pins':PINS,'home_us':home,'pose_a_us':a,'pose_b_us':b,
                          'phases':[p[0] for p in plan],
                          'nominal_seconds':round(sum(p[3] for p in plan)/SPEED,1),
                          'maximum_pulse_slew_us_per_second':BASE_SLEW*SPEED}))
        return
    if not args.port:
        parser.error('port required for physical motion')
    import serial
    from serial.tools import list_ports
    if not any(p.device==args.port and p.serial_number=='A5069RR4A' for p in list_ports.comports()):
        raise RuntimeError('Expected Nano unavailable; no motion sent')
    dev = serial.Serial(None, 115200, timeout=.025, write_timeout=.5)
    dev.dtr = False
    dev.rts = False
    dev.port = args.port
    dev.open()
    commands = queue.Queue()
    current = None
    last_beat = 0
    cycles = 0
    verified = False
    fault = None

    def reader():
        while True:
            try:
                commands.put(input().strip().lower())
            except EOFError:
                commands.put('stop')
                return

    def control():
        while not commands.empty():
            cmd = commands.get_nowait()
            if cmd in ('stop', 'off'):
                raise KeyboardInterrupt
            if cmd == 'home':
                raise HomeRequest

    def exchange(payload, expected, check=True):
        dev.write(payload.encode('ascii'))
        pending = set(expected)
        deadline = time.monotonic() + 1.5
        while pending and time.monotonic() < deadline:
            if check:
                control()
            line = dev.readline().decode('ascii', errors='replace').strip()
            pending.discard(line)
            if line.startswith(('ERR,', 'BOOT,', 'TIMEOUT,')):
                raise RuntimeError('Controller fault: ' + line)
        if pending:
            raise RuntimeError('Missing controller acknowledgement: ' + repr(pending))

    def heartbeat():
        nonlocal last_beat
        if time.monotonic() - last_beat >= .3:
            exchange('HEARTBEAT\n', {'ALIVE'})
            last_beat = time.monotonic()

    def send(values):
        nonlocal current
        for pin, value in zip(PINS, values):
            if not joints[pin]['min_us'] <= value <= joints[pin]['max_us']:
                raise RuntimeError('Target outside standalone bounds')
        if current is not None and any(abs(x-y) > 4 for x,y in zip(current, values)):
            raise RuntimeError('Trajectory discontinuity')
        exchange(''.join(f'SET,{p},{v}\n' for p,v in zip(PINS, values)), {f'OK,{p},{v}' for p,v in zip(PINS,values)})
        current = values

    def timeline(duration, sample):
        elapsed = 0
        previous = time.monotonic()
        while elapsed < duration:
            begin = time.monotonic()
            dt = begin - previous
            previous = begin
            if dt > .75:
                raise RuntimeError('Control timing gap')
            control()
            heartbeat()
            elapsed = min(duration, elapsed + min(dt, .1 / SPEED) * SPEED)
            send(sample(elapsed))
            time.sleep(max(0, .05 - (time.monotonic() - begin)))

    def go_home():
        start = current
        duration = move_duration(start,home)
        timeline(duration, lambda t: blend(start, home, t, duration))

    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            dev.write(b'PING\n')
            line = dev.readline().decode(errors='replace').strip()
            if line == data['firmware_identity']:
                verified = True
                break
            if line.startswith('PONG,'):
                raise RuntimeError('Wrong firmware; no motion sent')
        if not verified:
            raise RuntimeError('Identity unavailable; no motion sent')
        dev.reset_input_buffer()
        dev.write(b'STATUS\n')
        states = {}
        deadline = time.monotonic() + 1.5
        while len(states) < 8 and time.monotonic() < deadline:
            fields = dev.readline().decode(errors='replace').strip().split(',')
            if len(fields) == 3 and fields[0] == 'STATE':
                states[int(fields[1])] = int(fields[2])
        if len(states) != 8:
            raise RuntimeError('Incomplete initial status; no motion sent')
        current = starting_pulses(states,joints,args.confirmed_home)
        threading.Thread(target=reader, daemon=True).start()
        heartbeat()
        send(current)
        if current != home:
            go_home()
        print(json.dumps({'event':'gesture_started','gesture':args.gesture,'pins':PINS,'home_us':home,'pose_a_us':a,'pose_b_us':b,'speed_scale':SPEED,'cycles_requested':args.cycles}), flush=True)
        while args.cycles == 0 or cycles < args.cycles:
            for name, start, target, duration in plan:
                print(json.dumps({'event':'phase','name':name}),flush=True)
                if duration:
                    timeline(duration,lambda t: blend(start,target,t,duration))
            cycles += 1
            print(json.dumps({'event':'cycle_complete','cycles':cycles,'home_commands_acknowledged':True}), flush=True)
            final_gesture = 'left' if args.gesture == 'sequence' else args.gesture
            end = time.monotonic() + data[final_gesture+'_gesture']['rest_seconds']
            while time.monotonic() < end:
                control()
                heartbeat()
                time.sleep(.05)
    except HomeRequest:
        if current is not None:
            go_home()
            print('HOME return acknowledged', flush=True)
    except KeyboardInterrupt:
        print('STOP requested', flush=True)
    except Exception as exc:
        fault = str(exc)
        print(json.dumps({'event':'fault','reason':fault}),flush=True)
    finally:
        off = False
        try:
            if verified:
                try:
                    exchange(''.join(f'OFF,{p}\n' for p in PINS), {f'OFF,{p}' for p in PINS}, check=False)
                    off = True
                except Exception as exc:
                    fault = fault or str(exc)
                    print(json.dumps({'event':'off_unconfirmed','reason':str(exc)}),flush=True)
        finally:
            dev.close()
            print(json.dumps({'event':'ended','cycles':cycles,'outputs_off_acknowledged':off,'calibrator_changed':False,'fault':fault,'physical_position_measured':False}), flush=True)
    if fault:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
