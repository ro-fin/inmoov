"""Short-lived, one-use pairing for a manually opened local Studio tab."""
import secrets
import threading
import time


class PairingCodes:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.code = None
        self.expires = 0
        self.attempts = 0

    def issue(self):
        with self.lock:
            self.code = f'{secrets.randbelow(100_000_000):08d}'
            self.expires = self.clock() + 600
            self.attempts = 0
            return dict(code=self.code, expiresIn=600)

    def redeem(self, code):
        with self.lock:
            if not self.code or self.clock() >= self.expires or self.attempts >= 5:
                return False
            self.attempts += 1
            if not isinstance(code, str) or len(code) != 8 or not code.isascii() or not code.isdigit():
                return False
            if not secrets.compare_digest(code, self.code):
                return False
            self.code = None
            return True
