// Probe test: prints the raw moisture value twice a second. Use it to find RAW_DRY and RAW_WET.
// Wiring: moisture board AO -> A0, VCC -> A1 (or 5V), GND -> GND. Serial Monitor @115200.

void setup() {
  Serial.begin(115200);
  pinMode(A1, OUTPUT);
  digitalWrite(A1, HIGH);  // powers the board if its VCC is on A1; harmless if VCC is on 5V
}

void loop() {
  Serial.println(analogRead(A0));  // touch air, dry paper, wet sponge, peel... and watch this number
  delay(500);
}
