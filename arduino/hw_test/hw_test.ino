// Hardware test: checks every part one by one. Serial Monitor @115200.
// Press the Arduino's RESET button to run the start-up checks again.
//   1. LEDs green, red, yellow, blue light one after another
//   2. buzzer beeps 3 times
//   3. matrix: all dots on, then a checkerboard
//   4. servo: swings 0 -> 90 -> 0
//   5. then live sensor readings twice a second

#include <DHT.h>
#include <Servo.h>

const byte DHT_PIN = 2, BUZZ = 3, TRIG = 4, ECHO = 5, SERVO_PIN = 6;
const byte LED_DRY = 7, LED_WET = 8, LED_UNC = 9;
const byte MX_CLK = 10, MX_CS = 11, MX_DIN = 12;
const byte PROBE = A0, PROBE_PWR = A1, AUX = A2, LED_SENT = A3;

DHT dht(DHT_PIN, DHT11);
Servo arm;

void mx(byte reg, byte val) {
  digitalWrite(MX_CS, LOW);
  shiftOut(MX_DIN, MX_CLK, MSBFIRST, reg);
  shiftOut(MX_DIN, MX_CLK, MSBFIRST, val);
  digitalWrite(MX_CS, HIGH);
}

void fill(byte a, byte b) { for (byte r = 0; r < 8; r++) mx(r + 1, r % 2 ? b : a); }

int distanceCm() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long us = pulseIn(ECHO, HIGH, 25000);
  return us ? us / 58 : -1;  // -1 = no echo
}

void setup() {
  Serial.begin(115200);
  const byte outs[] = {BUZZ, TRIG, LED_DRY, LED_WET, LED_UNC, MX_CLK, MX_CS, MX_DIN, PROBE_PWR, LED_SENT};
  for (byte p : outs) pinMode(p, OUTPUT);
  pinMode(ECHO, INPUT);
  digitalWrite(MX_CS, HIGH);
  dht.begin();

  Serial.println("# TEST 1: LEDs  green(D7) red(D8) yellow(D9) blue(A3)");
  const byte leds[] = {LED_DRY, LED_WET, LED_UNC, LED_SENT};
  for (byte i = 0; i < 2; i++)
    for (byte p : leds) { digitalWrite(p, HIGH); delay(500); digitalWrite(p, LOW); }

  Serial.println("# TEST 2: buzzer  3 beeps");
  for (byte i = 0; i < 3; i++) { tone(BUZZ, 2000, 200); delay(400); }

  Serial.println("# TEST 3: matrix  all on, then checkerboard");
  mx(0x0F, 0); mx(0x09, 0); mx(0x0B, 7); mx(0x0A, 2); mx(0x0C, 1);
  fill(0xFF, 0xFF); delay(1500);
  fill(0xAA, 0x55); delay(1500);

  Serial.println("# TEST 4: servo  0 -> 90 -> 0");
  arm.attach(SERVO_PIN);
  arm.write(0); delay(700); arm.write(90); delay(700); arm.write(0); delay(700);
  arm.detach();

  Serial.println("# TEST 5: live readings (dist_cm -1 = nothing seen, rh/temp nan = DHT not answering)");
}

void loop() {
  digitalWrite(PROBE_PWR, HIGH); delay(20);
  int moist = analogRead(PROBE);
  digitalWrite(PROBE_PWR, LOW);
  Serial.print("dist_cm="); Serial.print(distanceCm());
  Serial.print("  rh="); Serial.print(dht.readHumidity());
  Serial.print("  temp="); Serial.print(dht.readTemperature());
  Serial.print("  moist_raw="); Serial.print(moist);
  Serial.print("  gas_raw="); Serial.println(analogRead(AUX));
  delay(500);
}
