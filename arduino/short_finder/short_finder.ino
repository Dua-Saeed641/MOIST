// Short finder: put a wire from A4 into any breadboard hole.
// The orange "L" LED on the Arduino lights when that hole is connected to GND.
// Safe: A4 only uses a weak internal pull-up, no real current flows.

void setup() {
  Serial.begin(115200);
  pinMode(A4, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  bool toGnd = digitalRead(A4) == LOW;
  digitalWrite(LED_BUILTIN, toGnd);
  Serial.println(toGnd ? "CONNECTED TO GND" : "not connected to GND");
  delay(300);
}
