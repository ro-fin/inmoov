"""V8 serial frames: sequence + CRC-16/CCITT; independent of servo semantics."""
import binascii

def frame(sequence, payload):
    if not 0 <= sequence <= 65535 or not payload or any(c in payload for c in '\r\n*@'):
        raise ValueError('Invalid serial frame.')
    body = f'{sequence},{payload}'
    checksum = binascii.crc_hqx(body.encode('ascii'), 0xffff)
    return f'@{body}*{checksum:04X}'

def parse_frame(line):
    try:
        if not line.startswith('@'): return None
        body, checksum = line[1:].rsplit('*', 1)
        if len(checksum) != 4 or binascii.crc_hqx(body.encode('ascii'), 0xffff) != int(checksum,16): return None
        number, payload = body.split(',',1)
        sequence = int(number)
        if not number.isdigit() or not 0 <= sequence <= 65535 or not payload: return None
        return sequence, payload
    except (ValueError, UnicodeError):
        return None
