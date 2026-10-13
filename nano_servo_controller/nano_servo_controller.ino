#include <Servo.h>
#include <stdlib.h>
#include <string.h>

// Classic ATmega328P Nano expansion shield: command pin numbers are D2-D13.
// D0/D1 remain reserved for USB serial. All outputs home at boot.
// Boot home holds until browser control begins; then the watchdog is active.
constexpr uint8_t FIRST_PIN = 2, LAST_PIN = 13, COUNT = 12;
constexpr unsigned long BAUD = 115200, TIMEOUT_MS = 2000;
Servo servos[COUNT];
char buffer[48];
uint8_t length = 0;
bool overflow = false;
unsigned long lastContact = 0;
bool watchdogArmed = false;
uint16_t commandedUs[COUNT] = {};
void contact() { lastContact = millis(); watchdogArmed = true; }

void off(uint8_t pin) {
  servos[pin - FIRST_PIN].detach();
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  commandedUs[pin - FIRST_PIN] = 0;
}
void allOff() { for (uint8_t pin = FIRST_PIN; pin <= LAST_PIN; ++pin) off(pin); }
void identity() { Serial.println(F("PONG,ROBOATTIS,NANO,DIRECT,12,115200,D2-D13,V3,AUTOHOME90")); }
void reportState() {
  for (uint8_t pin = FIRST_PIN; pin <= LAST_PIN; ++pin) {
    Serial.print(F("STATE,")); Serial.print(pin); Serial.print(',');
    Serial.println(commandedUs[pin - FIRST_PIN]);
  }
}
bool number(char *s, long &value) {
  if (!s || !*s) return false;
  for (char *p = s; *p; ++p) if (*p < '0' || *p > '9') return false;
  char *end;
  value = strtol(s, &end, 10);
  return !*end;
}
void process(char *line) {
  // Read-only queries do not end the standalone boot-home hold.
  if (!strcmp(line, "PING")) { identity(); return; }
  if (!strcmp(line, "STATUS")) { reportState(); return; }
  if (!strcmp(line, "HEARTBEAT")) { contact(); return; }
  if (!strcmp(line, "ALL_OFF")) { contact(); allOff(); Serial.println(F("ALL_OFF")); return; }
  char *command = strtok(line, ",");
  char *pinText = strtok(NULL, ",");
  char *pulseText = strtok(NULL, ",");
  char *extra = strtok(NULL, ",");
  long pin, pulse;
  if (!command || !number(pinText, pin) || pin < FIRST_PIN || pin > LAST_PIN || extra) {
    Serial.println(F("ERR,COMMAND_OR_PIN")); return;
  }
  if (!strcmp(command, "OFF") && !pulseText) {
    contact(); off(pin); Serial.print(F("OFF,")); Serial.println(pin); return;
  }
  const bool home = !strcmp(command, "HOME") && !pulseText;
  if (home) pulse = 1500;  // Nominal 90 degrees for mechanical horn alignment.
  if (!home && (strcmp(command, "SET") || !number(pulseText, pulse) || pulse < 500 || pulse > 2500)) {
    Serial.println(F("ERR,COMMAND_OR_PULSE")); return;
  }
  Servo &servo = servos[pin - FIRST_PIN];
  // Preload the requested pulse before attaching, avoiding a default-center pulse.
  servo.writeMicroseconds(pulse);
  if (!servo.attached()) servo.attach(pin, 500, 2500);
  servo.writeMicroseconds(pulse);
  commandedUs[pin - FIRST_PIN] = pulse;
  contact();
  Serial.print(F("OK,")); Serial.print(pin); Serial.print(','); Serial.println(pulse);
}
void setup() {
  allOff();
  Serial.begin(BAUD);
  for (uint8_t pin = FIRST_PIN; pin <= LAST_PIN; ++pin) {
    Servo &servo = servos[pin - FIRST_PIN];
    servo.writeMicroseconds(1500);
    servo.attach(pin, 500, 2500);
    servo.writeMicroseconds(1500);
    commandedUs[pin - FIRST_PIN] = 1500;
  }
  lastContact = millis();
  Serial.println(F("BOOT,AUTOHOME90"));
  identity();
}
void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (overflow) Serial.println(F("ERR,TOO_LONG"));
      else if (length) { buffer[length] = 0; process(buffer); }
      length = 0; overflow = false;
    } else if (!overflow) {
      if (length < sizeof(buffer) - 1) buffer[length++] = c;
      else overflow = true;
    }
  }
  if (watchdogArmed && millis() - lastContact > TIMEOUT_MS) {
    bool active = false;
    for (uint8_t i = 0; i < COUNT; ++i) active |= servos[i].attached();
    if (active) { allOff(); Serial.println(F("TIMEOUT,ALL_OFF")); }
  }
}
