#include <Servo.h>
#include <stdlib.h>
#include <string.h>

uint16_t crc16(const char *text) {
  uint16_t crc = 0xffff;
  while (*text) {
    crc ^= (uint16_t)(uint8_t)*text++ << 8;
    for (uint8_t i=0; i<8; ++i) crc = (crc & 0x8000) ? (crc << 1)^0x1021 : crc << 1;
  }
  return crc;
}
bool framedReply = false, cacheReply = false, cacheValid = false;
uint16_t replySequence = 0, lastSequence = 0, lastRequestCrc = 0, requestCrc = 0;
char cachedReply[100] = {};
void sendFrame(uint16_t sequence, const char *payload) {
  char body[112];
  snprintf(body, sizeof(body), "%u,%s", sequence, payload);
  char checksum[6];
  snprintf(checksum, sizeof(checksum), "%04X", crc16(body));
  Serial.print('@'); Serial.print(body); Serial.print('*'); Serial.println(checksum);
}
class Reply : public Print {
  char line[100];
  uint8_t size = 0;
public:
  using Print::write;
  size_t write(uint8_t c) override {
    if (!framedReply) return Serial.write(c);
    if (c == '\r') return 1;
    if (c == '\n') {
      line[size] = 0;
      sendFrame(replySequence, line);
      if (cacheReply) {
        strcpy(cachedReply, line);
        lastSequence = replySequence; lastRequestCrc = requestCrc; cacheValid = true;
      }
      size = 0;
    } else if (size < sizeof(line)-1) line[size++] = c;
    return 1;
  }
} reply;

// Classic ATmega328P Nano: consecutive arm channels from D2 through D9.
// D0/D1 remain reserved for USB serial. Outputs stay off at boot.
// Left: D2,D3,D4,D5; right: D6,D7,D8,D9. Same joint order on each side.
constexpr uint8_t COUNT = 8;
constexpr uint8_t PINS[COUNT] = {2, 3, 4, 5, 6, 7, 8, 9};
int8_t pinIndex(long pin) {
  for (uint8_t i=0; i<COUNT; ++i) if (PINS[i] == pin) return i;
  return -1;
}
constexpr unsigned long BAUD = 115200, TIMEOUT_MS = 2000;
constexpr uint16_t MIN_PULSE_US = 500, MAX_PULSE_US = 2500;
// 270-degree positional servos use calibrated microseconds, never Servo.write(angle).
// All eight servo profiles: 0 / 135 / 270 degrees -> 500 / 1500 / 2500 us.
// The controller supplies these endpoints with every ANGLE command.
Servo servos[COUNT];
char buffer[144];
uint8_t length = 0;
bool overflow = false;
unsigned long lastContact = 0;
bool watchdogArmed = true;
uint16_t commandedUs[COUNT] = {};
void contact() { lastContact = millis(); watchdogArmed = true; }

void off(uint8_t pin) {
  int8_t index = pinIndex(pin);
  if (index < 0) return;
  servos[index].detach();
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  commandedUs[index] = 0;
}
void allOff() { for (uint8_t i=0; i<COUNT; ++i) off(PINS[i]); }
void identity() { reply.println(F("PONG,ROBOATTIS,NANO,ARMS,8,115200,D2-D9,V8")); }
void reportState() {
  for (uint8_t i=0; i<COUNT; ++i) {
    uint8_t pin = PINS[i];
    reply.print(F("STATE,")); reply.print(pin); reply.print(',');
    reply.println(commandedUs[i]);
  }
}
bool number(char *s, long &value) {
  if (!s || !*s) return false;
  char *p = s;
  if (*p == '-') ++p;
  if (!*p || strlen(p) > 6) return false;
  for (; *p; ++p) if (*p < '0' || *p > '9') return false;
  char *end;
  value = strtol(s, &end, 10);
  return !*end;
}
void process(char *line) {
  // Queries never enable outputs. No blocking reads or delay() in the loop.
  if (!strcmp(line, "PING")) { identity(); return; }
  if (!strcmp(line, "VERSION")) { reply.println(F("VERSION,ARMS,V8,270DEG,CRC16")); return; }
  if (!strcmp(line, "STATUS")) { reportState(); return; }
  if (!strcmp(line, "HEARTBEAT")) { contact(); reply.println(F("ALIVE")); return; }
  if (!strcmp(line, "ALL_OFF")) { contact(); allOff(); reply.println(F("ALL_OFF")); return; }
  if (strstr(line, ",,") || !*line || line[strlen(line)-1] == ',') {
    reply.println(F("ERR,EMPTY_FIELD")); return;
  }
  char *command = strtok(line, ",");
  char *pinText = strtok(NULL, ",");
  char *pulseText = strtok(NULL, ",");
  char *extra = strtok(NULL, ",");
  long pin, pulse;
  if (!command || !number(pinText, pin) || pinIndex(pin) < 0) {
    reply.println(F("ERR,COMMAND_OR_PIN")); return;
  }
  if (!strcmp(command, "OFF") && !pulseText && !extra) {
    contact(); off(pin); reply.print(F("OFF,")); reply.println(pin); return;
  }
  bool checkOnly = !strcmp(command, "CHECK_ANGLE");
  if (!strcmp(command, "ANGLE") || checkOnly) {
    // ANGLE,pin,millidegrees,angleAtMinUs,angleAtMaxUs,minUs,maxUs
    long angle, lowAngle, highAngle, lowUs, highUs;
    char *highAngleText = strtok(NULL, ",");
    char *lowUsText = strtok(NULL, ",");
    char *highUsText = strtok(NULL, ",");
    char *trailing = strtok(NULL, ",");
    if (!number(pulseText, angle) || !number(extra, lowAngle) ||
        !number(highAngleText, highAngle) || !number(lowUsText, lowUs) ||
        !number(highUsText, highUs) || trailing || lowAngle == highAngle ||
        lowAngle < -360000 || lowAngle > 360000 || highAngle < -360000 || highAngle > 360000 ||
        angle < min(lowAngle, highAngle) || angle > max(lowAngle, highAngle) ||
        lowUs < MIN_PULSE_US || highUs > MAX_PULSE_US || lowUs >= highUs) {
      reply.println(F("ERR,ANGLE_OR_CALIBRATION")); return;
    }
    int64_t numerator = (int64_t)(angle-lowAngle)*(highUs-lowUs);
    long denominator = highAngle-lowAngle;
    if (denominator < 0) { denominator = -denominator; numerator = -numerator; }
    pulse = lowUs + (numerator + denominator/2)/denominator;
    if (checkOnly) {
      reply.print(F("CALC,")); reply.print(pin); reply.print(','); reply.println(pulse);
      return;
    }
  } else if (strcmp(command, "SET") || extra || !number(pulseText, pulse) || pulse < MIN_PULSE_US || pulse > MAX_PULSE_US) {
    reply.println(F("ERR,COMMAND_OR_PULSE")); return;
  }
  const uint8_t index = pinIndex(pin);
  Servo &servo = servos[index];
  // Preload the requested pulse before attaching, avoiding a default-center pulse.
  servo.writeMicroseconds(pulse);
  if (!servo.attached()) servo.attach(pin, MIN_PULSE_US, MAX_PULSE_US);
  servo.writeMicroseconds(pulse);
  commandedUs[index] = pulse;
  contact();
  reply.print(F("OK,")); reply.print(pin); reply.print(','); reply.println(pulse);
}
void receive(char *line) {
  if (*line != '@') {
    if (!strcmp(line,"ALL_OFF")) cacheValid = false;
    process(line);
    return;
  }
  char *star = strrchr(line, '*');
  if (!star || strlen(star+1) != 4) return;
  char *end;
  unsigned long expected = strtoul(star+1, &end, 16);
  if (*end) return;
  *star = 0;
  requestCrc = crc16(line+1);
  if (requestCrc != expected) return; // Corrupt command never reaches a servo.
  char *comma = strchr(line+1, ',');
  if (!comma) return;
  *comma = 0;
  long sequence;
  if (!number(line+1,sequence) || sequence < 0 || sequence > 65535) return;
  char *payload = comma+1;
  framedReply = true; replySequence = sequence;
  bool control = !strcmp(payload,"ALL_OFF") || !strncmp(payload,"SET,",4) ||
                 !strncmp(payload,"ANGLE,",6) || !strncmp(payload,"OFF,",4);
  cacheReply = false;
  if (sequence == 0 && strcmp(payload,"HEARTBEAT")) {
    reply.println(F("ERR,RESERVED_SEQUENCE"));
  } else if (control && cacheValid && sequence == lastSequence) {
    if (requestCrc == lastRequestCrc) { contact(); sendFrame(sequence,cachedReply); }
    else reply.println(F("ERR,SEQUENCE_REUSE"));
  } else if (control && cacheValid && (uint16_t)(sequence-lastSequence) >= 32768) {
    reply.println(F("ERR,STALE_SEQUENCE"));
  } else {
    cacheReply = control;
    process(payload);
  }
  framedReply = false; cacheReply = false;
}
void setup() {
  allOff();
  Serial.begin(BAUD);
  lastContact = millis();
  Serial.println(F("BOOT,ARMS,V8"));
}
void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (overflow) Serial.println(F("ERR,TOO_LONG"));
      else if (length) { buffer[length] = 0; receive(buffer); }
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
