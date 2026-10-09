import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, Polygon, FancyBboxPatch, FancyArrowPatch

W, H = 1620, 1090
fig = plt.figure(figsize=(W / 100, H / 100))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, W); ax.set_ylim(H, 0); ax.axis("off")
fig.patch.set_facecolor("white")

RED, BLK = "#d62728", "#222222"
def line(pts, c, lw=2.2, z=2):
    xs, ys = zip(*pts); ax.plot(xs, ys, color=c, lw=lw, solid_capstyle="round", zorder=z)
def dot(x, y, c=BLK): ax.add_patch(Circle((x, y), 4.5, color=c, zorder=5))
def text(x, y, s, size=9, **kw):
    kw.setdefault("ha", "center"); kw.setdefault("va", "center")
    ax.text(x, y, s, fontsize=size, zorder=6, **kw)
def box(x0, x1, y0, y1, fc, title, tc="white", size=10):
    ax.add_patch(FancyBboxPatch((x0, y0), x1 - x0, y1 - y0, boxstyle="round,pad=0,rounding_size=8",
                                fc=fc, ec=BLK, lw=1.5, zorder=3))
    text((x0 + x1) / 2, y0 + 18, title, size, color=tc, weight="bold")

# ---------------- Arduino UNO ----------------
BX0, BX1, BY0, BY1 = 570, 1080, 470, 700
ax.add_patch(FancyBboxPatch((BX0, BY0), BX1 - BX0, BY1 - BY0, boxstyle="round,pad=0,rounding_size=14",
                            fc="#00878A", ec=BLK, lw=2, zorder=1))
ax.add_patch(Rectangle((540, 520), 60, 55, fc="#bbbbbb", ec=BLK, zorder=2)); text(570, 547, "USB", 8)
ax.add_patch(Rectangle((540, 615), 45, 50, fc="#333333", ec=BLK, zorder=2)); text(562, 640, "DC", 7, color="white")
text(825, 590, "ARDUINO UNO", 20, color="white", weight="bold")
text(825, 620, "USB cable -> laptop (power + data)", 9, color="white")

TOP = {}
x = 600
for p in ["AREF", "GND", "13", "12", "11", "10", "9", "8", None, "7", "6", "5", "4", "3", "2", "1", "0"]:
    if p is None: x += 14; continue
    TOP[p] = x; x += 28
BOT = {}
x = 640
for p in ["IOREF", "RST", "3V3", "5V", "GND", "GND2", "VIN", None, "A0", "A1", "A2", "A3", "A4", "A5"]:
    if p is None: x += 14; continue
    BOT[p] = x; x += 28
for p, x in TOP.items():
    ax.add_patch(Rectangle((x - 9, 481), 18, 18, fc="#111", ec="#888", zorder=4))
    text(x, 512, p, 7.5, color="white", rotation=90)
for p, x in BOT.items():
    ax.add_patch(Rectangle((x - 9, 671), 18, 18, fc="#111", ec="#888", zorder=4))
    text(x, 645, p.replace("GND2", "GND"), 7.5, color="white", rotation=90)
TOP_PIN_Y, BOT_PIN_Y = 481, 689

# ---------------- rails ----------------
RT5, RTG = 60, 85          # top rails, fed by the power module
RB5, RBG = 1000, 1025      # bottom rails, fed by Arduino 5V
line([(150, RT5), (1440, RT5)], RED, 4); line([(150, RTG), (1440, RTG)], BLK, 4)
text(1445, RT5, "+5V  (power module)", 8.5, ha="left", color=RED, weight="bold")
text(1445, RTG, "GND", 8.5, ha="left", weight="bold")
line([(700, RB5), (1440, RB5)], RED, 4); line([(700, RBG), (1440, RBG)], BLK, 4)
text(1445, RB5, "+5V  (Arduino)", 8.5, ha="left", color=RED, weight="bold")
text(1445, RBG, "GND", 8.5, ha="left", weight="bold")
line([(BOT["5V"], BOT_PIN_Y), (BOT["5V"], RB5)], RED); dot(BOT["5V"], RB5, RED)
line([(BOT["GND"], BOT_PIN_Y), (BOT["GND"], RBG)], BLK); dot(BOT["GND"], RBG)
# common ground: Arduino GND <-> power-module GND
line([(1440, RTG), (1440, RBG)], BLK, 3); dot(1440, RTG); dot(1440, RBG)
text(1432, 560, "COMMON GND\n(must connect!)", 8.5, ha="right", weight="bold")

# power module (MB102)
box(15, 140, 25, 120, "#f2c200", "POWER\nMODULE", tc=BLK, size=9)
text(77, 88, "MB102 yellow/black\njumpers on 5V", 6.5)
line([(140, RT5), (150, RT5)], RED, 4); line([(140, RTG), (150, RTG)], BLK, 4)
text(77, 140, "in: USB power bank\nor 9V barrel jack", 7.5)

def rail_pin(x, y_top, net, label):
    ry = RT5 if net == "5V" else RTG
    line([(x, y_top), (x, ry)], RED if net == "5V" else BLK); dot(x, ry, RED if net == "5V" else BLK)
    text(x, y_top - 9, label, 7.5, weight="bold", bbox=dict(fc="white", ec="none", pad=0.5))

# ---------------- signal routing ----------------
def pin_tag(x, y, s, c):
    text(x, y, "to " + s, 7.5, weight="bold", color=BLK,
         bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=c, lw=2))

def route_top(wires):
    """wires: (comp_x, comp_y, header_pin, color). Lanes chosen so wires never cross."""
    left = sorted([w for w in wires if w[0] < TOP[w[2]]], key=lambda w: w[0])
    right = sorted([w for w in wires if w[0] >= TOP[w[2]]], key=lambda w: -w[0])
    for group in (left, right):
        for i, (cx, cy, pin, c) in enumerate(group):
            ly = 455 - 12 * i
            px = TOP[pin]
            line([(cx, cy), (cx, ly), (px, ly), (px, TOP_PIN_Y)], c)
            pin_tag(cx, cy + 32, "D" + pin, c)

def route_bot(wires):
    left = sorted([w for w in wires if w[0] < BOT[w[2]]], key=lambda w: w[0])
    right = sorted([w for w in wires if w[0] >= BOT[w[2]]], key=lambda w: -w[0])
    for group in (left, right):
        for i, (cx, cy, pin, c) in enumerate(group):
            ly = 718 + 13 * i
            px = BOT[pin]
            line([(cx, cy), (cx, ly), (px, ly), (px, BOT_PIN_Y)], c)
            pin_tag(cx, cy - 26, pin, c)

def sig_label(x, y, s):
    text(x, y + 10, s, 7.5, weight="bold", bbox=dict(fc="white", ec="none", pad=0.5))

top_wires = []

# 8x8 matrix (MAX7219)
box(170, 340, 125, 320, "#1f4e9c", "8x8 LED MATRIX\n(MAX7219)", size=8.5)
for r in range(8):
    for c in range(8):
        ax.add_patch(Circle((205 + c * 14, 175 + r * 14), 4.5, color="#ff4d4d" if (r + c) % 3 else "#661111", zorder=4))
rail_pin(200, 125, "5V", "VCC"); rail_pin(240, 125, "GND", "GND")
for x, lab, pin, c in [(195, "DIN", "12", "#1f77b4"), (255, "CS", "11", "#17becf"), (315, "CLK", "10", "#9467bd")]:
    sig_label(x, 320, lab); top_wires.append((x, 320, pin, c))

# single LEDs with 220 ohm
def led_top(x, color, name, pin):
    line([(x, RTG), (x, 150)], BLK); dot(x, RTG)
    ax.add_patch(Polygon([(x - 11, 190), (x + 11, 190), (x, 168)], fc=color, ec=BLK, zorder=4))  # points up to cathode
    line([(x - 12, 166), (x + 12, 166)], BLK, 2.5, 4); line([(x, 150), (x, 168)], BLK)
    line([(x, 190), (x, 215)], BLK)
    ax.add_patch(Rectangle((x - 6, 215), 12, 45, fc="#e8d5a8", ec=BLK, zorder=4))
    text(x + 10, 238, "220Ω", 7, ha="left")
    line([(x, 260), (x, 320)], BLK)
    text(x, 135, name, 8, weight="bold", bbox=dict(fc="white", ec="none", pad=0.5))
    top_wires.append((x, 320, pin, color))
led_top(400, "#f0c000", "YELLOW\n(unsure)", "9")
led_top(455, "#e02020", "RED\n(wet)", "8")
led_top(510, "#20a020", "GREEN\n(dry)", "7")

# servo
box(650, 800, 150, 320, "#2a6fdb", "SERVO SG90\n= PROBE ARM", size=8.5)
ax.add_patch(Rectangle((665, 225), 50, 32, fc="#9cc3ff", ec=BLK, zorder=4))        # servo body
ax.add_patch(Circle((700, 241), 7, fc="white", ec=BLK, zorder=5))                  # horn
line([(700, 241), (785, 241)], "#c8a165", 6, 5)                                    # stick
for sx in (776, 788):
    ax.add_patch(Rectangle((sx - 3, 244), 6, 16, fc="#b0b0b0", ec=BLK, zorder=6))  # screws
ax.add_patch(FancyArrowPatch((770, 222), (762, 292), connectionstyle="arc3,rad=-0.4",
                             arrowstyle="-|>", mutation_scale=12, color="white", lw=1.6, zorder=6))
text(722, 302, "taps down, back up", 7, color="white")
text(783, 272, "probe", 6.5, color="white")
rail_pin(675, 150, "5V", "+ red"); rail_pin(745, 150, "GND", "- brown")
sig_label(765, 320, "SIG orange"); top_wires.append((765, 320, "6", "#ff7f0e"))

# HC-SR04
box(840, 1020, 150, 320, "#3a7d44", "ULTRASONIC\nHC-SR04", size=8.5)
for cx in (885, 975):
    ax.add_patch(Circle((cx, 240), 28, fc="#cfcfcf", ec=BLK, lw=1.5, zorder=4))
    ax.add_patch(Circle((cx, 240), 14, fc="#555", zorder=5))
rail_pin(870, 150, "5V", "VCC"); rail_pin(1000, 150, "GND", "GND")
sig_label(930, 320, "ECHO"); top_wires.append((930, 320, "5", "#2ca02c"))
sig_label(975, 320, "TRIG"); top_wires.append((975, 320, "4", "#8c564b"))

# buzzer
box(1050, 1150, 150, 320, "#333333", "BUZZER", size=8.5)
ax.add_patch(Circle((1100, 240), 32, fc="#111", ec="#777", lw=2, zorder=4)); ax.add_patch(Circle((1100, 240), 5, color="#777", zorder=5))
rail_pin(1125, 150, "GND", "-"); sig_label(1080, 320, "+"); top_wires.append((1080, 320, "3", "#e377c2"))

# DHT11
box(1180, 1310, 150, 320, "#3b8ede", "DHT11\nhumidity", size=8.5)
for r in range(6):
    for c in range(5):
        ax.add_patch(Rectangle((1215 + c * 13, 195 + r * 13), 9, 9, fc="#cfe3fb", zorder=4))
rail_pin(1205, 150, "5V", "VCC +"); rail_pin(1290, 150, "GND", "GND -")
sig_label(1245, 320, "DATA / S"); top_wires.append((1245, 320, "2", "#bcbd22"))

route_top(top_wires)

# ---------------- bottom components ----------------
bot_wires = []
# moisture board = the broken MH-series module, probe wired where the black sensor was
box(800, 990, 780, 885, "#1f6f3f", "MH MODULE (broken one)\n= moisture board", size=8)
text(895, 832, "pot only affects DO", 7, color="white")
text(830, 772, "AO", 7.5, weight="bold", bbox=dict(fc="white", ec="none", pad=0.5)); bot_wires.append((830, 780, "A0", "#d62728"))
text(870, 772, "VCC", 7.5, weight="bold", bbox=dict(fc="white", ec="none", pad=0.5)); bot_wires.append((870, 780, "A1", "#ff9896"))
text(915, 772, "DO", 7.5, bbox=dict(fc="white", ec="none", pad=0.5)); text(915, 758, "(empty)", 6.5)
line([(965, 885), (965, RBG)], BLK); dot(965, RBG); text(975, 900, "GND", 7.5, ha="left", weight="bold")
for x in (825, 850):
    line([(x, 885), (x, 935)], "#7f7f7f", 2.5)
    ax.add_patch(Rectangle((x - 4, 935), 8, 30, fc="#b0b0b0", ec=BLK, zorder=4))
text(838, 978, "probe", 7, weight="bold")
text(700, 1062, "PROBE = 2 wires from the 2 holes of the broken black sensor -> 2 steel screws ~1 cm apart\n"
     "taped at the TIP OF THE SERVO ARM (top of the picture). The worker's hand never touches the waste.", 7.5,
     ha="left", weight="bold")

# golden-cylinder module (optional gas/aux)
box(1030, 1200, 780, 885, "#1f6f3f", "MH MODULE (golden)\noptional gas sensor", size=8)
ax.add_patch(Rectangle((1095, 840), 40, 30, fc="#d4af37", ec=BLK, zorder=4))
text(1060, 772, "AO", 7.5, weight="bold", bbox=dict(fc="white", ec="none", pad=0.5)); bot_wires.append((1060, 780, "A2", "#9edae5"))
line([(1150, 885), (1150, RB5)], RED); dot(1150, RB5, RED); text(1145, 900, "VCC", 7.5, ha="right", weight="bold")
line([(1185, 885), (1185, RBG)], BLK); dot(1185, RBG); text(1190, 915, "GND", 7.5, ha="left", weight="bold")

# blue LED
x = 1280
ax.add_patch(Rectangle((x - 6, 785), 12, 45, fc="#e8d5a8", ec=BLK, zorder=4)); text(x + 10, 807, "220Ω", 7, ha="left")
line([(x, 780), (x, 785)], BLK); line([(x, 830), (x, 860)], BLK)
ax.add_patch(Polygon([(x - 11, 860), (x + 11, 860), (x, 882)], fc="#1f5fff", ec=BLK, zorder=4))
line([(x - 12, 884), (x + 12, 884)], BLK, 2.5, 4); line([(x, 884), (x, RBG)], BLK); dot(x, RBG)
text(x + 16, 870, "BLUE\n(sent)", 8, ha="left", weight="bold")
bot_wires.append((x, 780, "A3", "#1f5fff"))
route_bot(bot_wires)

# ---------------- notes ----------------
ax.add_patch(FancyBboxPatch((15, 735), 660, 345, boxstyle="round,pad=0,rounding_size=10", fc="#f7f7f7", ec="#999", zorder=1))
text(30, 757, "MØIST GLOVE - WIRING (Arduino UNO)", 13, ha="left", weight="bold")
pins = """D2  DHT11 DATA             A0  moisture board AO
D3  buzzer +               A1  moisture board VCC
D4  HC-SR04 TRIG           A2  golden module AO (optional)
D5  HC-SR04 ECHO           A3  blue LED  (+220 ohm)
D6  servo SIG (orange)
D7  green LED  (+220 ohm)  5V  -> bottom + rail
D8  red LED    (+220 ohm)  GND -> bottom - rail
D9  yellow LED (+220 ohm)
D10 matrix CLK             power module 5V -> top rails
D11 matrix CS
D12 matrix DIN"""
text(30, 778, pins, 8.6, ha="left", va="top", family="monospace")
ly0 = 955
line([(32, ly0), (72, ly0)], RED, 3.5); text(80, ly0, "+5V", 8.5, ha="left")
line([(140, ly0), (180, ly0)], BLK, 3.5); text(188, ly0, "GND", 8.5, ha="left")
line([(250, ly0), (290, ly0)], "#1f77b4", 2.5); text(298, ly0, "signal", 8.5, ha="left")
dot(375, ly0); text(385, ly0, "= joined.  Crossing without a dot = NOT joined", 8.5, ha="left")
tips = """- LED: long leg (+) to the resistor side, short leg (-) to GND.
- Power-module GND and Arduino GND MUST be joined (right edge).
- Servo gets 5V from the power module, never from the Arduino.
- Unplug USB before changing any wire.
- Not used: stepper, RGB LED, PIR motion sensor, capacitors."""
text(30, 975, tips, 8.6, ha="left", va="top")

fig.savefig(__file__.replace("wiring.py", "wiring.png"), dpi=130)
fig.savefig(__file__.replace("wiring.py", "wiring.svg"))
