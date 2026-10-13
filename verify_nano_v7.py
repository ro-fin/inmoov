"""Read-only angle calculation checks on the connected Nano; no servo enable."""
import json
import statistics
import time
from pathlib import Path
import serial
import argparse
from arm_desktop import PINS, IDENTITY

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', required=True)
    args = parser.parse_args()
    with serial.Serial(args.port, 115200, timeout=.1, write_timeout=.5) as dev:
        time.sleep(2)
        dev.reset_input_buffer()
        def query(command, prefix):
            start = time.perf_counter()
            dev.write((command+'\n').encode())
            while time.perf_counter()-start < 1:
                line = dev.readline().decode('ascii', errors='replace').strip()
                if line.startswith(prefix): return line, (time.perf_counter()-start)*1000
            raise RuntimeError('No expected response to '+command)
        assert query('ALL_OFF', 'ALL_OFF')[0] == 'ALL_OFF'
        identity = query('PING', 'PONG,')[0]
        assert identity == IDENTITY, identity
        version = query('VERSION', 'VERSION,')[0]
        assert version == 'VERSION,ARMS,V7,270DEG,D2-D9', version
        for pin in PINS:
            for angle, pulse in [(0, 500), (135000, 1500), (270000, 2500)]:
                actual, _ = query(f'CHECK_ANGLE,{pin},{angle},0,270000,500,2500', 'CALC,')
                assert actual == f'CALC,{pin},{pulse}', actual
                actual, _ = query(f'CHECK_ANGLE,{pin},{angle},270000,0,500,2500', 'CALC,')
                assert actual == f'CALC,{pin},{3000-pulse}', actual
        for command, expected in [
            ('CHECK_ANGLE,2,0,0,80000,1400,1600', 'CALC,2,1400'),
            ('CHECK_ANGLE,2,40000,0,80000,1400,1600', 'CALC,2,1500'),
            ('CHECK_ANGLE,9,80000,0,80000,1400,1600', 'CALC,9,1600'),
            ('CHECK_ANGLE,6,20000,80000,0,1400,1600', 'CALC,6,1550'),
            ('CHECK_ANGLE,4,-5000,-25000,55000,1400,1600', 'CALC,4,1450'),
            ('SET,10,1500', 'ERR,COMMAND_OR_PIN'),
            ('OFF,10', 'ERR,COMMAND_OR_PIN'),
            ('ANGLE,10,135000,0,270000,500,2500', 'ERR,COMMAND_OR_PIN'),
            ('ANGLE,2,90000,0,80000,1400,1600', 'ERR,ANGLE_OR_CALIBRATION'),
            ('ANGLE,2,0,0,0,1400,1600', 'ERR,ANGLE_OR_CALIBRATION'),
            ('ANGLE,2,40000,0,80000,400,2600', 'ERR,ANGLE_OR_CALIBRATION'),
            ('ANGLE,2,,0,80000,1400,1600', 'ERR,EMPTY_FIELD'),
        ]:
            actual, _ = query(command, expected.split(',')[0]+',')
            assert actual == expected, (command, actual)
        samples = [query('PING', 'PONG,')[1] for _ in range(30)]
        dev.write(b'STATUS\n')
        states = [dev.readline().decode().strip() for _ in range(8)]
        assert states == [f'STATE,{pin},0' for pin in PINS], states
        result = dict(port=args.port, identity=identity, version=version, outputs='all off',
                      pingSamples=len(samples), medianRoundTripMs=round(statistics.median(samples),2),
                      maximumRoundTripMs=round(max(samples),2), angleChecks='passed')
        Path('nano_v7_verification.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result))

if __name__ == '__main__': main()
