"""Independent single-joint home return; never writes calibrator settings."""
import argparse
import json
import math
import queue
import threading
import time
from pathlib import Path

SAFETY = Path(__file__).with_name('left_arm_safety.json')


def validate_joint(joint):
    for key in ('pin', 'home_us', 'min_us', 'max_us'):
        if type(joint.get(key)) is not int:
            raise ValueError('Invalid standalone joint profile.')
    if not 2 <= joint['pin'] <= 9 or not 500 <= joint['min_us'] <= joint['home_us'] <= joint['max_us'] <= 2500:
        raise ValueError('Invalid standalone safety bounds.')
    if joint['min_us'] == joint['max_us']:
        raise ValueError('Safety range cannot be empty.')
    return joint


def lift_value_to_pulse(joint, value):
    """Bicep display 0 is home; display 68 is the tested maximum lift."""
    if not math.isfinite(value) or not joint['display_home'] <= value <= joint['display_max_lift']:
        raise ValueError('Lift value is outside the standalone limits.')
    span = joint['display_max_lift'] - joint['display_home']
    fraction = (value - joint['display_home']) / span
    return round(joint['home_us'] + fraction * (joint['max_lift_us'] - joint['home_us']))


def home_targets(joint, start_us, slew=40, period=.05):
    validate_joint(joint)
    if type(start_us) is not int or not joint['min_us'] <= start_us <= joint['max_us']:
        raise ValueError('Starting pulse is outside the standalone safety limits.')
    if not 0 < slew <= 40 or period <= 0 or slew * period > 3:
        raise ValueError('Invalid controlled homing rate.')
    duration = max(2, abs(joint['home_us'] - start_us) / slew + 1)
    ticks = math.ceil(duration / period)
    for tick in range(ticks + 1):
        t = min(duration, tick * period)
        speed = 1 / (duration - 1)
        if t < 1:
            fraction = speed * t * t / 2
        elif t <= duration - 1:
            fraction = speed * (t - .5)
        else:
            fraction = 1 - speed * (duration - t) ** 2 / 2
        target = round(start_us + fraction * (joint['home_us'] - start_us))
        if not joint['min_us'] <= target <= joint['max_us']:
            raise ValueError('Homing target exceeds safety limits.')
        yield target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', required=True)
    parser.add_argument('--pin', type=int, required=True)
    parser.add_argument('--start-us', type=int, required=True)
    args = parser.parse_args()
    data = json.loads(SAFETY.read_text(encoding='utf-8'))
    joint = validate_joint(next(j for j in data['joints'] if j['pin'] == args.pin))
    targets = list(home_targets(joint, args.start_us))  # Validate everything before opening/energizing.
    import serial
    dev = serial.Serial(None, 115200, timeout=.025, write_timeout=.5)
    dev.dtr = False
    dev.rts = False
    dev.port = args.port
    dev.open()
    commands = queue.Queue()

    def reader():
        while True:
            try:
                commands.put(input().strip().lower())
            except EOFError:
                commands.put('stop')
                return

    def check_stop():
        while not commands.empty():
            if commands.get_nowait() in ('stop', 'off'):
                raise KeyboardInterrupt

    def exchange(command, expected):
        dev.write((command + '\n').encode('ascii'))
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            check_stop()
            line = dev.readline().decode('ascii', errors='replace').strip()
            if line == expected:
                return
            if line.startswith(('ERR,', 'BOOT,', 'TIMEOUT,')):
                raise RuntimeError('Controller fault; homing aborted: ' + line)
        raise RuntimeError('Missing reply; homing aborted.')

    last_beat = 0
    acknowledged = 0
    last_target = None
    completed = False
    off_confirmed = False
    try:
        deadline = time.monotonic() + 5
        verified = False
        while time.monotonic() < deadline:
            dev.write(b'PING\n')
            line = dev.readline().decode('ascii', errors='replace').strip()
            if line == data['firmware_identity']:
                verified = True
                break
            if line.startswith('PONG,'):
                raise RuntimeError('Wrong Nano firmware; no movement sent.')
        if not verified:
            raise RuntimeError('Nano identity not verified; no movement sent.')
        threading.Thread(target=reader, daemon=True).start()
        print('STANDALONE HOME: ' + joint['name'] + '; safety bounds loaded.', flush=True)
        for target in targets:
            begin = time.monotonic()
            check_stop()
            if begin - last_beat >= .3:
                exchange('HEARTBEAT', 'ALIVE')
                last_beat = time.monotonic()
            exchange(f'SET,{args.pin},{target}', f'OK,{args.pin},{target}')
            acknowledged += 1
            last_target = target
            time.sleep(max(0, .05 - (time.monotonic() - begin)))
        hold_end = time.monotonic() + 3
        while time.monotonic() < hold_end:
            check_stop()
            exchange('HEARTBEAT', 'ALIVE')
            time.sleep(.2)
        completed = True
    finally:
        try:
            dev.write(f'OFF,{args.pin}\n'.encode('ascii'))
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                if dev.readline().decode(errors='replace').strip() == f'OFF,{args.pin}':
                    off_confirmed = True
                    break
        finally:
            dev.close()
        print(json.dumps(dict(completed=completed, pin=args.pin, finalHomePulseUs=last_target,
                              homePulseUs=joint['home_us'], commandsAcknowledged=acknowledged,
                              outputsOffAcknowledged=off_confirmed, otherMotionPinsCommanded=False,
                              calibratorSettingsChanged=False, physicalPositionMeasured=False)), flush=True)


if __name__ == '__main__':
    main()
