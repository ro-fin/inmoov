#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

// ---------- PCA9685 SETUP ----------
// Use 1 for one board (16 servos), or 2 for two boards (32 servos).
constexpr uint8_t PCA_COUNT = 1;
constexpr uint8_t PCA0_ADDRESS = 0x40;
constexpr uint8_t PCA1_ADDRESS = 0x41;  // Board 2: solder the A0 jumper.

static_assert(PCA_COUNT >= 1 && PCA_COUNT <= 2, "PCA_COUNT must be 1 or 2");

Adafruit_PWMServoDriver pwm0 = Adafruit_PWMServoDriver(PCA0_ADDRESS);
Adafruit_PWMServoDriver pwm1 = Adafruit_PWMServoDriver(PCA1_ADDRESS);

constexpr uint8_t CHANNELS_PER_PCA = 16;
constexpr uint8_t CHANNEL_COUNT = PCA_COUNT * CHANNELS_PER_PCA;
constexpr uint16_t SERVO_FREQUENCY_HZ = 50;
constexpr uint32_t SERIAL_BAUD = 500000;
constexpr uint16_t HARD_MIN_US = 500;
constexpr uint16_t HARD_MAX_US = 2500;

#if defined(ARDUINO_AVR_UNO)
  #define CONTROLLER_BOARD "UNO"
#elif defined(ARDUINO_AVR_MEGA2560)
  #define CONTROLLER_BOARD "MEGA2560"
#else
  #define CONTROLLER_BOARD "ARDUINO"
#endif

char commandBuffer[48];
uint8_t commandLength = 0;
bool pca0Present = false;
bool pca1Present = false;

bool i2cPresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void printI2cStatus() {
  pca0Present = i2cPresent(PCA0_ADDRESS);
  pca1Present = PCA_COUNT == 2 && i2cPresent(PCA1_ADDRESS);
  Serial.print(F("I2C,0x"));
  Serial.print(PCA0_ADDRESS, HEX);
  Serial.print(pca0Present ? F(",OK") : F(",MISSING"));
  if (PCA_COUNT == 2) {
    Serial.print(F(",0x"));
    Serial.print(PCA1_ADDRESS, HEX);
    Serial.print(pca1Present ? F(",OK") : F(",MISSING"));
  }
  Serial.println();
}

void scanI2cBus() {
  bool found = false;
  Serial.print(F("SCAN"));
  for (uint8_t address = 1; address < 127; ++address) {
    if (i2cPresent(address)) {
      Serial.print(F(",0x"));
      if (address < 16) Serial.print('0');
      Serial.print(address, HEX);
      found = true;
    }
  }
  if (!found) Serial.print(F(",NONE"));
  Serial.println();
}

void setServoPulse(uint8_t channel, uint16_t pulseUs) {
  pulseUs = constrain(pulseUs, HARD_MIN_US, HARD_MAX_US);
  if (channel < CHANNELS_PER_PCA) pwm0.writeMicroseconds(channel, pulseUs);
  else if (PCA_COUNT == 2) pwm1.writeMicroseconds(channel - CHANNELS_PER_PCA, pulseUs);
}

void disableChannel(uint8_t channel) {
  if (channel < CHANNELS_PER_PCA) pwm0.setPWM(channel, 0, 4096);
  else if (PCA_COUNT == 2) pwm1.setPWM(channel - CHANNELS_PER_PCA, 0, 4096);
}

void printIdentity(const __FlashStringHelper *messageType) {
  Serial.print(messageType);
  Serial.print(F(",ROBOATTIS," CONTROLLER_BOARD ",PCA9685X"));
  Serial.print(PCA_COUNT);
  Serial.print(',');
  Serial.print(CHANNEL_COUNT);
  Serial.print(',');
  Serial.print(SERIAL_BAUD);
  Serial.print(F(",0x"));
  Serial.print(PCA0_ADDRESS, HEX);
  if (PCA_COUNT == 2) {
    Serial.print(F(",0x"));
    Serial.print(PCA1_ADDRESS, HEX);
  }
  Serial.println();
}

void processCommand(char *command) {
  uint8_t channel;
  uint16_t pulseUs;

  if (sscanf(command, "SET,%hhu,%hu", &channel, &pulseUs) == 2) {
    if (channel >= CHANNEL_COUNT || pulseUs < HARD_MIN_US || pulseUs > HARD_MAX_US) {
      Serial.println(F("ERR,RANGE"));
      return;
    }
    setServoPulse(channel, pulseUs);
    Serial.print(F("OK,"));
    Serial.print(channel);
    Serial.print(',');
    Serial.println(pulseUs);
    return;
  }

  if (sscanf(command, "OFF,%hhu", &channel) == 1) {
    if (channel >= CHANNEL_COUNT) {
      Serial.println(F("ERR,CHANNEL"));
      return;
    }
    disableChannel(channel);
    Serial.print(F("OFF,"));
    Serial.println(channel);
    return;
  }

  if (strcmp(command, "ALL_OFF") == 0) {
    for (uint8_t i = 0; i < CHANNEL_COUNT; ++i) disableChannel(i);
    Serial.println(F("ALL_OFF"));
    return;
  }

  if (strcmp(command, "PING") == 0) {
    printIdentity(F("PONG"));
    return;
  }

  if (strcmp(command, "I2C") == 0) {
    printI2cStatus();
    return;
  }


  if (strcmp(command, "SCAN") == 0) {
    scanI2cBus();
    return;
  }

  Serial.println(F("ERR,COMMAND"));
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  Wire.begin();
  Wire.setClock(100000);
  pca0Present = i2cPresent(PCA0_ADDRESS);
  pca1Present = PCA_COUNT == 2 && i2cPresent(PCA1_ADDRESS);
  pwm0.begin();
  pwm0.setOscillatorFrequency(25000000);
  pwm0.setPWMFreq(SERVO_FREQUENCY_HZ);
  if (PCA_COUNT == 2) {
    pwm1.begin();
    pwm1.setOscillatorFrequency(25000000);
    pwm1.setPWMFreq(SERVO_FREQUENCY_HZ);
  }

  for (uint8_t i = 0; i < CHANNEL_COUNT; ++i) disableChannel(i);
  delay(10);
  printIdentity(F("READY"));
}

void loop() {
  while (Serial.available()) {
    const char incoming = Serial.read();
    if (incoming == '\n' || incoming == '\r') {
      if (commandLength > 0) {
        commandBuffer[commandLength] = '\0';
        processCommand(commandBuffer);
        commandLength = 0;
      }
    } else if (commandLength < sizeof(commandBuffer) - 1) {
      commandBuffer[commandLength++] = incoming;
    } else {
      commandLength = 0;
      Serial.println(F("ERR,TOO_LONG"));
    }
  }
}
