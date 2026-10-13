"""Hardware V8 protocol soak; only queries and output-disable commands."""
import argparse
import json
import statistics
import time
from pathlib import Path
import serial
from arm_desktop import IDENTITY, PINS
from serial_protocol import frame, parse_frame

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',required=True)
    args=parser.parse_args()
    with serial.Serial(args.port,115200,timeout=.02,write_timeout=.5) as dev:
        time.sleep(2)
        dev.reset_input_buffer()
        def raw(payload):
            dev.write((payload+'\n').encode())
            end=time.monotonic()+1
            while time.monotonic()<end:
                line=dev.readline().decode().strip()
                if line: return line
            raise TimeoutError(payload)
        assert raw('ALL_OFF')=='ALL_OFF'
        assert raw('PING')==IDENTITY
        assert raw('VERSION')=='VERSION,ARMS,V8,270DEG,CRC16'
        samples=[]
        def query(seq,payload,expected):
            start=time.perf_counter()
            dev.write((frame(seq,payload)+'\n').encode())
            end=time.monotonic()+1
            while time.monotonic()<end:
                line=dev.readline().decode().strip()
                decoded=parse_frame(line)
                if decoded:
                    assert decoded==(seq,expected),(payload,decoded,expected)
                    samples.append((time.perf_counter()-start)*1000)
                    return
            raise TimeoutError(payload)
        query(1,'ALL_OFF','ALL_OFF')
        query(1,'ALL_OFF','ALL_OFF') # Identical retry returns the cached reply.
        query(2,'OFF,2','OFF,2')
        query(2,'OFF,2','OFF,2')
        query(2,'OFF,3','ERR,SEQUENCE_REUSE')
        query(1,'OFF,2','ERR,STALE_SEQUENCE')
        query(3,'ALL_OFF','ALL_OFF')
        bad=frame(4,'CHECK_ANGLE,2,135000,0,270000,500,2500')
        bad=bad[:-1]+('0' if bad[-1]!='0' else '1')
        dev.write((bad+'\n').encode())
        assert not dev.readline(), 'Corrupt checksum must receive no valid reply.'
        seq=4
        for pin in PINS:
            for angle,pulse in [(0,500),(135000,1500),(270000,2500)]:
                query(seq,f'CHECK_ANGLE,{pin},{angle},0,270000,500,2500',f'CALC,{pin},{pulse}');seq+=1
                query(seq,f'CHECK_ANGLE,{pin},{angle},270000,0,500,2500',f'CALC,{pin},{3000-pulse}');seq+=1
        start=time.monotonic()
        for i in range(600):
            query(0,'HEARTBEAT','ALIVE')
            pin=PINS[i%8]
            query(seq,f'CHECK_ANGLE,{pin},135000,0,270000,500,2500',f'CALC,{pin},1500');seq+=1
            time.sleep(.012)
        elapsed=time.monotonic()-start
        assert raw('ALL_OFF')=='ALL_OFF'
        dev.write(b'STATUS\n')
        states=[dev.readline().decode().strip() for _ in PINS]
        assert states==[f'STATE,{pin},0' for pin in PINS],states
        result=dict(port=args.port,identity=IDENTITY,framedReplies=len(samples),
                    stressSeconds=round(elapsed,1),outputs='all off',
                    checksumRejection='passed',duplicateAndStaleSequences='passed',
                    normalAndReversedAngles='passed',medianRoundTripMs=round(statistics.median(samples),2),
                    maxRoundTripMs=round(max(samples),2))
        Path('nano_v8_verification.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result))

if __name__=='__main__': main()
