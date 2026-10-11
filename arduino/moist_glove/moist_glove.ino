// MØIST glove firmware — Arduino UNO.
// Wiring: see hardware.md. Output: one JSON line per measurement on Serial @115200.
//
// Behaviour
// The worker's hand never touches the waste: the probe sits at the tip of a stick on the servo.
//   no target in range      -> matrix shows a dot, silent
//   target 12..30 cm away   -> matrix shows closeness 0..10 (10 = arm can reach), bar at the bottom
//   wet/rotting smell near  -> buzzer ticks faster the stronger it is (metal-detector style, from humidity + gas)
//   held at 10 for 0.6 s    -> servo swings the probe down, taps the item, measures, swings back up,
//                              prints JSON, shows W / D / ?, LEDs; triple beep if wet

#include <DHT.h>
#include <Servo.h>

// ---- pins (must match hardware.md) ----
const byte DHT_PIN = 2, BUZZ = 3, TRIG = 4, ECHO = 5, SERVO_PIN = 6;
const byte LED_DRY = 7, LED_WET = 8, LED_UNC = 9;  // green, red, yellow
const byte MX_CLK = 10, MX_CS = 11, MX_DIN = 12;   // MAX7219 8x8 matrix
const byte PROBE = A0, PROBE_PWR = A1, AUX = A2, LED_SENT = A3;  // A3 = blue

// ---- calibration knobs: set these from the moisture_raw values you see in Serial Monitor ----
const char *DEVICE_ID = "glove-01";
const int RAW_DRY = 990;    // measured 2026-10-10: dry paper / air ~970-1023
const int RAW_WET = 800;    // measured 2026-10-10: wet sponge / water ~770-880, wet finger ~650
const float DRY_MAX = 0.38, WET_MIN = 0.62;  // same cut-offs as web/src/config.ts CLASS_CUTOFFS
const int NEAR_CM = 12;     // sonar reading when the lowered arm tip just touches the item
const int FAR_CM = 30;      // beyond this: "no target"
const byte ARM_UP = 0, ARM_DOWN = 90;  // servo angles: parked / probe touching. Tune for your mount
const bool HAS_AUX = false; // golden module on A2 fitted? set true once it's wired (false -> gas_raw is null)
const bool MX_MIRROR = false;  // flip if digits appear mirrored on your matrix
const bool DHT_IS_22 = false;  // blue DHT11 = false, white DHT22 = true

DHT dht(DHT_PIN, DHT_IS_22 ? DHT22 : DHT11);
Servo arm;

// ---------- MAX7219 (no library needed) ----------
void mx(byte reg, byte val) {
  digitalWrite(MX_CS, LOW);
  shiftOut(MX_DIN, MX_CLK, MSBFIRST, reg);
  shiftOut(MX_DIN, MX_CLK, MSBFIRST, val);
  digitalWrite(MX_CS, HIGH);
}

byte flip(byte b) {
  byte r = 0;
  for (byte i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
  return r;
}

void draw(const byte rows[8]) {
  for (byte r = 0; r < 8; r++) mx(r + 1, MX_MIRROR ? flip(rows[r]) : rows[r]);
}

const byte DIGIT[10][5] = {  // 3x5 font
  {7,5,5,5,7}, {2,6,2,2,7}, {7,1,7,4,7}, {7,1,7,1,7}, {5,5,7,1,1},
  {7,4,7,1,7}, {7,4,7,5,7}, {7,1,2,2,2}, {7,5,7,5,7}, {7,5,7,1,7}};
const byte GLYPH_WET[8]  = {0x81,0x81,0x81,0x81,0x99,0xA5,0xC3,0x81};
const byte GLYPH_DRY[8]  = {0xF8,0x84,0x82,0x82,0x82,0x82,0x84,0xF8};
const byte GLYPH_UNC[8]  = {0x3C,0x42,0x02,0x04,0x08,0x08,0x00,0x08};
const byte GLYPH_IDLE[8] = {0,0,0,0x18,0x18,0,0,0};

void showNumber(byte n) {  // 0..10 + bar graph on the bottom row
  byte rows[8] = {0};
  for (byte r = 0; r < 5; r++)
    rows[r + 1] = n >= 10 ? (DIGIT[1][r] << 5) | (DIGIT[0][r] << 1) : DIGIT[n][r] << 3;
  rows[7] = 0xFF << (8 - (n * 8 + 5) / 10);
  draw(rows);
}

// ---------- sensors ----------
int distanceCm() {  // 999 = nothing in range
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long us = pulseIn(ECHO, HIGH, 25000);
  return us ? us / 58 : 999;
}

float score(int raw) {  // 0 dry .. 1 wet; works whichever way your board's raw value moves
  return constrain((raw - RAW_DRY) / float(RAW_WET - RAW_DRY), 0.0, 1.0);
}

const char *classify(float m) { return m <= DRY_MAX ? "dry" : m >= WET_MIN ? "wet" : "uncertain"; }

void printNum(const char *key, float v, byte digits) {
  Serial.print(",\""); Serial.print(key); Serial.print("\":");
  if (isnan(v)) Serial.print("null"); else Serial.print(v, digits);
}

// ---------- one full measurement (report section 6.3) ----------
void moveArm(byte angle) {
  arm.attach(SERVO_PIN);
  arm.write(angle);
  delay(450);
  arm.detach();  // detached = no jitter, no current draw; the arm stays where it is
}

void measure(int dist) {
  const byte N = 7;
  int v[N];
  arm.attach(SERVO_PIN);
  arm.write(ARM_DOWN); delay(450);  // stays attached: holds the probe on the item
  digitalWrite(PROBE_PWR, HIGH); delay(50);  // power the probe only while reading: slows corrosion
  for (byte i = 0; i < N; i++) { v[i] = analogRead(PROBE); delay(100); }
  digitalWrite(PROBE_PWR, LOW);
  arm.detach();
  moveArm(ARM_UP);
  int slope = v[N - 1] - v[0];
  for (byte i = 1; i < N; i++)  // insertion sort for the median
    for (byte j = i; j > 0 && v[j - 1] > v[j]; j--) { int t = v[j]; v[j] = v[j - 1]; v[j - 1] = t; }
  int raw = v[N / 2];
  float m = score(raw);
  const char *cls = classify(m);

  Serial.print("{\"device_id\":\""); Serial.print(DEVICE_ID); Serial.print('"');
  printNum("moisture_raw", raw, 0);
  printNum("moisture_slope", slope, 0);
  printNum("moisture_score", m, 3);
  Serial.print(",\"class\":\""); Serial.print(cls); Serial.print('"');
  printNum("air_temp_c", dht.readTemperature(), 1);
  printNum("air_rh_pct", dht.readHumidity(), 1);
  printNum("gas_raw", HAS_AUX ? analogRead(AUX) : NAN, 0);
  printNum("distance_cm", dist, 0);
  Serial.println('}');

  digitalWrite(LED_SENT, HIGH);
  digitalWrite(LED_DRY, cls[0] == 'd');
  digitalWrite(LED_WET, cls[0] == 'w');
  digitalWrite(LED_UNC, cls[0] == 'u');
  draw(cls[0] == 'w' ? GLYPH_WET : cls[0] == 'd' ? GLYPH_DRY : GLYPH_UNC);
  for (byte i = 0; i < (cls[0] == 'w' ? 3 : 1); i++) { tone(BUZZ, cls[0] == 'w' ? 2500 : 1200, 150); delay(250); }
  delay(2000);
  digitalWrite(LED_SENT, LOW);
}

// ---------- main loop ----------
float rhBase = NAN;  // room humidity at startup
// ponytail: fixed baseline; re-take it (reset the board) if you walk somewhere much more humid
float rhHint = 0;
int gasBase = 0;  // gas reading at startup (clean air)
unsigned long lastDht = 0, lastBeep = 0, nearSince = 0;
bool armed = true;  // false after a measurement until the hand moves away

void setup() {
  Serial.begin(115200);
  const byte outs[] = {BUZZ, TRIG, LED_DRY, LED_WET, LED_UNC, MX_CLK, MX_CS, MX_DIN, PROBE_PWR, LED_SENT};
  for (byte p : outs) pinMode(p, OUTPUT);
  pinMode(ECHO, INPUT);
  digitalWrite(MX_CS, HIGH);
  mx(0x0F, 0); mx(0x09, 0); mx(0x0B, 7); mx(0x0A, 2); mx(0x0C, 1);  // test off, raw, 8 rows, dim, on
  draw(GLYPH_IDLE);
  dht.begin();
  delay(2000);  // DHT needs ~2 s after power-up
  rhBase = dht.readHumidity();
  gasBase = analogRead(AUX);
  moveArm(ARM_UP);
  Serial.println("# moist glove ready");  // lines starting with # are not readings
}

void loop() {
  int d = distanceCm();
  unsigned long now = millis();

  if (now - lastDht > 2000) {  // DHT is slow; it only hints at wetness while hovering
    lastDht = now;
    float rh = dht.readHumidity();
    if (!isnan(rh) && !isnan(rhBase)) rhHint = constrain((rh - rhBase) / 15.0, 0.0, 1.0);
  }

  if (d > FAR_CM) {
    draw(GLYPH_IDLE);
    digitalWrite(LED_DRY, LOW); digitalWrite(LED_WET, LOW); digitalWrite(LED_UNC, LOW);
    nearSince = 0;
    armed = true;
    delay(60);
    return;
  }

  byte closeness = d <= NEAR_CM ? 10 : 10 - (10L * (d - NEAR_CM) + (FAR_CM - NEAR_CM) / 2) / (FAR_CM - NEAR_CM);
  showNumber(closeness);
  if (d > NEAR_CM + 3) armed = true;

  // no contact while hovering: hint from humidity rise and (if fitted) gas rise above startup values
  float gasHint = HAS_AUX ? constrain((analogRead(AUX) - gasBase) / 200.0, 0.0, 1.0) : 0;
  float wet = max(rhHint, gasHint);
  if (wet > DRY_MAX) {  // metal-detector tick: 900 ms apart when slightly wet, 60 ms when soaked
    unsigned long gap = 900 - 840 * (wet - DRY_MAX) / (1 - DRY_MAX);
    if (now - lastBeep > gap) { tone(BUZZ, 2500, 25); lastBeep = now; }
  }

  if (closeness == 10 && armed) {
    if (!nearSince) nearSince = now;
    if (now - nearSince > 600) { measure(d); armed = false; nearSince = 0; }
  } else {
    nearSince = 0;
  }
  delay(40);
}
